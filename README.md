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

Sequentia is a Bitcoin sidechain for asset tokenization and disintermediated
exchanges, built as a fork of Blockstream Elements. **Everything here is testnet
software; testnet assets carry no value.**

## Frontend vs indexer

This repo is frontend-only. The Rust indexer that actually serves the REST API
lives in a separate repo:

| Repo | One-liner |
|---|---|
| [`sequentia-explorer`](https://github.com/ConcatenaLabs/sequentia-explorer) | (this repo) Sequentia block explorer frontend (esplora fork); the indexer lives in sequentia-electrs. |
| [`sequentia-electrs`](https://github.com/ConcatenaLabs/sequentia-electrs) | The electrs fork: Rust indexer + Esplora REST API for Sequentia and its Bitcoin testnet4 parent chain. |
| [`Sequentia`](https://github.com/ConcatenaLabs/Sequentia) | The Sequentia node (`sequentiad`, a fork of Elements 23.3.3): consensus, anchoring, proof of stake, open fee market, plus the canonical protocol documentation in `doc/sequentia/`. |
| [`sequentia-registry`](https://github.com/ConcatenaLabs/sequentia-registry) | Sequentia Asset Registry service (asset metadata). |

The frontend talks to the indexer only over the Esplora REST API (same-origin
`/api`, proxied to electrs), so there is no build-time coupling between the two
repos. When the indexer's REST surface changes, update the frontend here to
match. Protocol-level documentation (anchoring, proof of stake, fees) lives in
[`Sequentia/doc/sequentia/`](https://github.com/ConcatenaLabs/Sequentia/tree/HEAD/doc/sequentia).

## What the explorer shows

Everything upstream Esplora shows (blocks, transactions, addresses, script
details, mempool), plus Sequentia-specific views:

- **Bitcoin anchor per block.** Every Sequentia block commits to a Bitcoin
  testnet4 block header; the block page shows the anchor (height + hash) and
  links it to the built-in testnet4 explorer, so you can follow a Sequentia
  block down to its Bitcoin anchor in one click
  (`esplora/client/src/views/block.js`).
- **Proof-of-stake committee certificate.** When a block's proof solution
  carries a decodable BLS committee certificate, the block page shows how
  many committee members signed it (`pos_certificate.signer_count`; the
  certificate also carries `leader_sig`, `agg_sig` and, on the current
  chain, the `signer_bitfield`). A "Finality" row is wired to the optional
  `finalized` block field, but the current indexer never populates that
  field, so the row does not render; finality is served separately by
  `GET /api/sequentia/checkpoints`.
- **Issued assets.** The Assets tab lists issued assets; asset pages show
  issuance, supply, and transactions. Asset names, tickers, and display
  precision come from the Sequentia Asset Registry (`ASSET_MAP_URL`, served
  same-origin at `/registry/index.minimal.json`).
- **Contracts.** A contract spend is labelled with its template's name and
  spending path (for example `drip · sequentia/faucet-drip v1`), linked to the
  template's record in the registry. The indexer decodes each contract input
  (`GET /api/tx/:txid/contracts`): its details show the program's cost against
  its budget (with any annex padding), the witness values by the names the
  template's descriptor gives them, and the contract's terms and state read
  from its data leaf by name and role (an asset by its id and ticker, a time as
  a date, a relative lock as its delay). An output that continues the contract
  carries the state it now holds, and links to the transaction that spends it
  next. A contract is named only by the registry's verified templates, and
  only when the template and the values the spend reveals recompute the very
  script it spends; a spend no template names shows its commitment root and
  its witness values unnamed. Where the indexer has no decoder, the label comes
  from the registry's contract index alone (`CONTRACT_MAP_URL`, served
  same-origin at `/registry/contracts/index.minimal.json`).
- **A page per contract.** `/explorer/contract/<root>/<parameters>` shows one
  contract instance, by its commitment root and its parameters: its terms, the
  coins that hold it now with their state, and every spend in order, each with
  its path, cost, witness, the state it found, the outputs `2k` and `2k+1` it
  owns where the template uses them, and the next state it made, so a contract
  re-created at a new address on each spend is followed across every
  re-creation. `/explorer/contract/<root>` lists every spend of a root.
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
[`sequentia-electrs`](https://github.com/ConcatenaLabs/sequentia-electrs))
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

- the front page at `/`, linking the explorer, the web wallet, the staking
  pool board, the faucet, the Compages bridge, Emissio rewards and the Sequentia Core download page
  (`/download/core/`); and the full menu at `/secretfullmenu`, linked from
  nowhere, listing every public service on the domain: the explorer, web
  wallet, staking pool board, SeqDEX, faucet, Emissio rewards, Compages
  bridge, Pignus lending, Levo launchpad, SeqPal, the inbound liquidity page
  and the full downloads page
- the inbound liquidity page at `/liquidity` (`liquidity.html`): what the
  web wallet's room-to-receive service holds, has locked in channels, has
  earned and has turned away, read in the browser from the LSP's public
  `/lsp/stats/inbound`; it holds no data of its own
- API proxies: `/api` -> Sequentia electrs (`SEQ_ELECTRS`, default
  `127.0.0.1:3003`), `/testnet4/api` -> testnet4 electrs (`T4_ELECTRS`,
  default `127.0.0.1:3004`)
- proxies for the other Sequentia services when they run on the same host:
  `/registry` (asset registry), `/prices` (market-data feed), `/dex` (SeqDEX
  daemon), `/seqob`, `/seqob-pln`, `/seqob-subas` and `/seqob-subasbuy` (one
  mount per SeqOB order-book relay, WebSocket included; see `SEQOB_RELAYS`),
  `/bridge` (Compages bridge)
- static mounts: `/download` (release artifacts, `DOWNLOAD_DIR`) and `/wallet`
  (the built SWK web wallet, `WALLET_DIR`)
- a proxy at `/faucet` to the testnet faucet, which is its own service
  ([`sequentia-faucet`](https://github.com/ConcatenaLabs/sequentia-faucet),
  `SEQ_FAUCET`, default `127.0.0.1:9960`)
- node-backed helpers that shell out to `sequentia-cli` on the host
  (fee-asset exchange rates at `GET /feerates`, how many
  of the broadcast nodes accept each fee asset, and how many list it at all (a node listing it at rate zero refuses it), at `GET /feeinfo`, how busy the
  next block is at `GET /congestion?asset=`, the producer's fee estimate at
  `GET /estimatefee?blocks=&asset=`, anchor
  reads at `GET /anchor/:hash` and `GET /anchorstatus`, chain health for the
  status page at `GET /chainstatus` (the tip's height and age, and whether its
  Bitcoin anchor is current), the testnet4 chains
  competing near the tip at `GET /testnet4/forks` (from `bitcoin-cli getchaintips`,
  `T4_CLI`/`T4_DATADIR`: while one exists Sequentia anchors nothing past the
  fork), and a `POST /api/tx`
  broadcast override that forwards raw transactions to a block producer). These
  default to the production box's node paths; override or ignore them for a
  local static+proxy setup.

See `deploy/README.md` for the systemd units and public exposure.

## API for integrators

The REST API is the Esplora HTTP API served by
[`sequentia-electrs`](https://github.com/ConcatenaLabs/sequentia-electrs).
`esplora/API.md` documents it, including the Sequentia-specific block fields
(`bitcoin_anchor`, `pos_certificate`; `finalized` is declared but never
populated), the Elements asset endpoints, `GET /api/sequentia/checkpoints`
and `GET /api/sequentia/anchorstatus`. Quick check:

```sh
curl -s https://sequentiatestnet.com/api/blocks/tip/height
```

## Repo layout

- `esplora/` - the Esplora frontend fork. Sequentia-specific changes are
  marked with `SEQUENTIA:` comments in `client/src/`; the flavor configs live
  in `esplora/flavors/sequentia-testnet/` and `esplora/flavors/bitcoin-testnet4/`.
- `build-public.sh` - builds both static flavors into `esplora/dist/`.
- `serve-public.js` - the production static+proxy server (Express 4).
- `feerates.js` - the fee-asset helpers behind `GET /feerates` and
  `GET /feeinfo`, with their own suite in `feerates.test.mjs`.
- `parent-forks.js` - the competing testnet4 chains behind `GET /testnet4/forks`,
  with their own suite in `parent-forks.test.mjs`.
- `liquidity-page.test.mjs` - the `/liquidity` page: its route, its menu card,
  and that it renders the LSP's figures as text
- `contract-labels.test.mjs` - the contract labels
  (`esplora/client/src/lib/contracts.js`) on a drip and its funding
  transaction recorded from a regtest chain (`test/fixtures/`);
  `contract-labels.regtest.test.mjs` - the same end to end: a local chain, the
  drip tool, sequentia-electrs, the registry, and this explorer built, served by
  `serve-public.js` and rendered in headless Chromium;
  `contract-views.regtest.test.mjs` - the decoded contract views end to end: a
  vault taken, topped up, repaid and liquidated in part by the regtest harness
  of sequentia-contracts, indexed and decoded by sequentia-electrs, and its
  transaction and contract pages rendered.
- `run-sequentia-explorer.sh`, `run-testnet4-explorer.sh` - local dev servers.
- `downloads/` - a copy of the `/download` page for a local run (built
  artifacts are dropped in at deploy time and are not committed). The pages
  the box serves, the full one and the Sequentia Core one at
  `/download/core/`, are tracked in the `sequentia-testnet-ops` repository.
- `deploy/` - production deployment: systemd user units + instructions.

## Sequentia changes vs upstream Esplora

The fork keeps upstream's structure; the Sequentia work is concentrated in:

- `esplora/flavors/sequentia-testnet/` - new flavor: chain config, asset
  registry wiring (`ASSET_MAP_URL`), contract index (`CONTRACT_MAP_URL`),
  branding CSS, network-switcher styling.
- `esplora/flavors/bitcoin-testnet4/` - parent-chain flavor used by the
  second explorer.
- `esplora/client/src/views/block.js` - Bitcoin anchor row, PoS committee
  signer count, checkpoint-finality row (renders only if the API ever sets
  `finalized`).
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
- `esplora/client/src/lib/contracts.js`, `views/tx-vin.js`, `views/tx-vout.js` -
  contract labels and next-spend links from the registry's contract index.
- `esplora/client/src/views/contract-parts.js`, `views/contract.js` - the
  decoded contract inputs and outputs, and the contract pages.
- `esplora/client/src/app.js` - market-data price fetch, contract index fetch,
  the decoded contracts of a transaction, the contract page routes
  (`contract/:root/:params`, `contract/:root`), settings wiring.

Upstream documentation is kept for reference: `esplora/README.md` (build
system, configuration options, upstream Docker deployment) and
`esplora/API.md` (REST API).

## Contributing

Open PRs against `main`. Frontend changes need `./build-public.sh` to succeed.
The tests:

```sh
node --test feerates.test.mjs parent-forks.test.mjs chainstatus.test.mjs contract-labels.test.mjs liquidity-page.test.mjs
SEQUENTIA_BIN=... FAUCET_DRIP=... ELECTRS=... REGISTRY_DIR=... SEQC=... CHROME=... \
  node --test contract-labels.regtest.test.mjs
SEQUENTIA_REPO=... CONTRACTS_DIR=... SEQC=... ELECTRS=... REGISTRY_DIR=... CHROME=... \
  node --test contract-views.regtest.test.mjs
```

The last two need a built node, a sequentia-electrs binary built with
`--features sequentia`, a registry checkout, `seqc` from sequentia-contracts
and a Chromium; the first of them also the faucet's drip tool, the second a
Sequentia checkout and a sequentia-contracts checkout for its regtest harness.
Each header says which is which, and each is skipped without them. Other views have no
automated coverage, so check them by clicking through the affected pages
against a running API.

## License

MIT (see `esplora/LICENSE`).
