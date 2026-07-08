# sequentia-explorer

The Sequentia block explorer frontend: a fork of
[Blockstream Esplora](https://github.com/Blockstream/esplora) adapted to the
Sequentia testnet, plus the small production server that serves the public
instance. It ships two explorers built from the same code: one for the
Sequentia chain and one for the Bitcoin testnet4 parent chain it anchors into,
cross-linked through a network switcher.

Live instance: https://sequentiatestnet.com/explorer/ (Sequentia) and
https://sequentiatestnet.com/testnet4/ (Bitcoin testnet4), behind the landing
page at https://sequentiatestnet.com/. The REST API is at
https://sequentiatestnet.com/api (Sequentia) and
https://sequentiatestnet.com/testnet4/api (Bitcoin testnet4).

Sequentia is a Bitcoin sidechain for asset tokenization and decentralized
exchange, built as a fork of Blockstream Elements. **Everything here is testnet
software; testnet assets carry no value.**

## Frontend vs indexer

This repo is frontend-only. The Rust indexer that actually serves the REST API
lives in a separate repo:

| Repo | One-liner |
|---|---|
| [`sequentia-explorer`](https://github.com/GracedEternalKingCabbageMan/sequentia-explorer) | (this repo) Sequentia block explorer frontend (esplora fork); the indexer lives in sequentia-electrs. |
| [`sequentia-electrs`](https://github.com/GracedEternalKingCabbageMan/sequentia-electrs) | The electrs fork: Rust indexer + Esplora REST API for Sequentia and its Bitcoin testnet4 parent chain. |
| [`Sequentia`](https://github.com/GracedEternalKingCabbageMan/Sequentia) | The Sequentia node (`elementsd` fork of Elements 23.3.3): consensus, anchoring, proof of stake, open fee market, plus the canonical protocol documentation in `doc/sequentia/`. |
| [`sequentia-registry`](https://github.com/GracedEternalKingCabbageMan/sequentia-registry) | Sequentia Asset Registry service (asset metadata). |

The frontend talks to the indexer only over the Esplora REST API (same-origin
`/api`, proxied to electrs), so there is no build-time coupling between the two
repos. When the indexer's REST surface changes, update the frontend here to
match. Protocol-level documentation (anchoring, proof of stake, fees) lives in
[`Sequentia/doc/sequentia/`](https://github.com/GracedEternalKingCabbageMan/Sequentia/tree/HEAD/doc/sequentia).

## What the explorer shows

Everything upstream Esplora shows (blocks, transactions, addresses, script
details, mempool), plus Sequentia-specific views:

- **Bitcoin anchor per block.** Every Sequentia block commits to a Bitcoin
  testnet4 block header; the block page shows the anchor (height + hash) and
  links it to the built-in testnet4 explorer, so you can follow a Sequentia
  block down to its Bitcoin anchor in one click
  (`esplora/client/src/views/block.js`).
- **Proof-of-stake committee certificate.** When a block's proof solution
  carries a decodable BLS committee certificate, the block's advanced view
  renders it: leader signature, BLS aggregate signature, and each signing
  member's keys. A "Finality" row shows checkpoint finality when the API
  supplies it.
- **Issued assets.** The Assets tab lists issued assets; asset pages show
  issuance, supply, and transactions. Asset names, tickers, and display
  precision come from the Sequentia Asset Registry (`ASSET_MAP_URL`, served
  same-origin at `/registry/index.minimal.json`).
- **Per-asset amounts and any-asset fees.** Sequentia has an open fee market:
  a transaction fee can be paid in any accepted asset, so fee rates are shown
  in the fee asset's own base units per vByte (never "sat/vB", which is
  Bitcoin-only), and transaction lists show every explicit asset transfer
  rather than a single native-asset value.
- **Reference-currency valuation.** A Settings page (local-only preferences)
  lets users pick a reference currency; amounts get an approximate value from
  the market-data feed at `/prices`.
- **Network switcher.** Toggles between the Sequentia explorer and the Bitcoin
  testnet4 explorer of the parent chain.

## Run it locally

Requires Node.js (the production server needs Express 4, already pinned in
`package.json`).

### Against the public API (no backend needed)

The public API sends `Access-Control-Allow-Origin: *`, so a local dev build
can use it directly:

```sh
cd esplora && npm install
source flavors/sequentia-testnet/config.env
export API_URL=https://sequentiatestnet.com/api
export ASSET_MAP_URL=https://sequentiatestnet.com/registry/index.minimal.json
npm run dev-server            # http://localhost:5000/
```

Reference-currency valuations stay empty in this mode (the `/prices` feed is
only reachable same-origin on the public server); everything else works.

### Against a local electrs

Run a Sequentia electrs (see
[`sequentia-electrs`](https://github.com/GracedEternalKingCabbageMan/sequentia-electrs))
with its REST API on `:3003` (and optionally a Bitcoin testnet4 electrs on
`:3004`), then:

```sh
cd esplora && npm install && cd ..
./run-sequentia-explorer.sh   # Sequentia explorer on :5001, /api -> 127.0.0.1:3003
./run-testnet4-explorer.sh    # Bitcoin testnet4 explorer on :5002, /api -> 127.0.0.1:3004
```

The dev server proxies `/api` to `$ELECTRS_HTTP`, so the explorer works over
any origin without baking the API address into the client.

## Production build and server

```sh
cd esplora && npm install
cd .. && ./build-public.sh    # -> esplora/dist/ (explorer/ + testnet4/)
npm install                   # Express 4 for serve-public.js
node serve-public.js          # everything on one port, default :8080
```

`build-public.sh` builds both flavors as static assets under one origin:
`/explorer/` (Sequentia) and `/testnet4/` (Bitcoin testnet4). `serve-public.js`
serves the static build plus, on the same origin:

- a landing page at `/` linking the explorer, wallet, bridge, rewards, and
  downloads
- API proxies: `/api` -> Sequentia electrs (`SEQ_ELECTRS`, default
  `127.0.0.1:3003`), `/testnet4/api` -> testnet4 electrs (`T4_ELECTRS`,
  default `127.0.0.1:3004`)
- proxies for the other Sequentia services when they run on the same host:
  `/registry` (asset registry), `/prices` (market-data feed), `/dex` (SeqDEX
  daemon), `/seqob` (SeqOB order-book relay, including its WebSocket),
  `/bridge` (Compages bridge)
- static mounts: `/download` (release artifacts, `DOWNLOAD_DIR`) and `/wallet`
  (the built SWK web wallet, `WALLET_DIR`)
- node-backed helpers that shell out to `elements-cli` on the host (testnet
  faucet at `POST /faucet`, fee-asset exchange rates at `GET /feerates`, anchor
  reads at `GET /anchor/:hash` and `GET /anchorstatus`, and a `POST /api/tx`
  broadcast override that forwards raw transactions to a block producer). These
  default to the production box's node paths; override or ignore them for a
  local static+proxy setup.

See `deploy/README.md` for the systemd units and public exposure.

## API for integrators

The REST API is the Esplora HTTP API served by
[`sequentia-electrs`](https://github.com/GracedEternalKingCabbageMan/sequentia-electrs).
`esplora/API.md` documents it, including the Sequentia-specific block fields
(`bitcoin_anchor`, `pos_certificate`, `finalized`), the Elements asset
endpoints, and `GET /api/sequentia/anchorstatus`. Quick check:

```sh
curl -s https://sequentiatestnet.com/api/blocks/tip/height
```

## Repo layout

- `esplora/` - the Esplora frontend fork. Sequentia-specific changes are
  marked with `SEQUENTIA:` comments in `client/src/`; the flavor configs live
  in `esplora/flavors/sequentia-testnet/` and `esplora/flavors/bitcoin-testnet4/`.
- `build-public.sh` - builds both static flavors into `esplora/dist/`.
- `serve-public.js` - the production static+proxy server (Express 4).
- `run-sequentia-explorer.sh`, `run-testnet4-explorer.sh` - local dev servers.
- `downloads/` - the `/download` landing page (committed; built artifacts are
  dropped in at deploy time and are not committed).
- `deploy/` - production deployment: systemd user units + instructions.

## Sequentia changes vs upstream Esplora

The fork keeps upstream's structure; the Sequentia work is concentrated in:

- `esplora/flavors/sequentia-testnet/` - new flavor: chain config, asset
  registry wiring (`ASSET_MAP_URL`), branding CSS, network-switcher styling.
- `esplora/flavors/bitcoin-testnet4/` - parent-chain flavor used by the
  second explorer.
- `esplora/client/src/views/block.js` - Bitcoin anchor row, PoS committee
  certificate rendering, checkpoint-finality row.
- `esplora/client/src/views/tx.js`, `transactions.js`, `mempool.js` -
  per-asset values, any-asset fees, fee rates in the fee asset's own units
  per vByte.
- `esplora/client/src/views/util.js` - asset-precision formatting, reference
  currency valuation, parent-chain block links
  (`PARENT_CHAIN_EXPLORER_BLOCK`).
- `esplora/client/src/views/settings.js` - local display preferences
  (reference currency, number/time format, theme).
- `esplora/client/src/views/lander.js`, `navbar.js`, `footer.js` - Sequentia
  and Concatena Labs branding.
- `esplora/client/src/app.js` - market-data price fetch, settings wiring.

Upstream documentation is kept for reference: `esplora/README.md` (build
system, configuration options, upstream Docker deployment) and
`esplora/API.md` (REST API).

## Contributing

Open PRs against `main`. Frontend changes need `./build-public.sh` to succeed;
there is no test suite in this repo beyond building and clicking through the
affected views against a running API.

## License

MIT (see `esplora/LICENSE`).
