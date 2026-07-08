# Public deployment

Serves the whole public site from one port (default `:8080`): a landing page
at `/`, the Sequentia explorer at `/explorer/`, the Bitcoin testnet4 explorer
at `/testnet4/`, the REST API proxies at `/api` and `/testnet4/api`, and the
static `/download` and `/wallet` mounts. A TLS terminator in front of that
port makes it public; the production instance is
https://sequentiatestnet.com behind a Caddy reverse proxy.

## Build + run

1. **Build** the static site (both flavors, relative links):
   `./build-public.sh` writes `esplora/dist/explorer/` (Sequentia) and
   `esplora/dist/testnet4/` (Bitcoin testnet4). Re-run after any frontend
   change. Requires a prior `npm install` in `esplora/`.
2. **Serve**: `node serve-public.js` serves `esplora/dist/`, renders the
   landing page at `/`, and proxies same-origin paths to local services.
   Requires **Express 4** (`npm install` at the repo root; Express 5 removed
   the `*` route syntax the SPA fallback uses). Configuration is entirely by
   environment variable:

   | Variable | Default | Proxied path |
   |---|---|---|
   | `SEQ_ELECTRS` | `127.0.0.1:3003` | `/api` (Sequentia Esplora REST) |
   | `T4_ELECTRS` | `127.0.0.1:3004` | `/testnet4/api` (Bitcoin testnet4 Esplora REST) |
   | `SEQ_REGISTRY` | `127.0.0.1:3005` | `/registry` (Asset Registry) |
   | `SEQ_PRICES` | `127.0.0.1:8088` | `/prices` (market-data feed) |
   | `SEQ_DEX` | `127.0.0.1:9945` | `/dex` (SeqDEX daemon) |
   | `SEQ_SEQOB` | `127.0.0.1:9955` | `/seqob` (SeqOB order-book relay, HTTP + WebSocket) |
   | `SEQ_BRIDGE` | `127.0.0.1:9950` | `/bridge` (Compages bridge UI + API) |
   | `PORT` | `8080` | listen port |
   | `DOWNLOAD_DIR` | `./downloads` | `/download` static mount |
   | `WALLET_DIR` | `./wallet` | `/wallet` static mount (built SWK web wallet) |

   The proxied services are optional: if one is not running, only its path
   returns errors.
3. **Node-backed helpers**: `serve-public.js` also shells out to a local
   `elements-cli` for the testnet faucet (`POST /faucet`), fee-asset exchange
   rates (`GET /feerates`), anchor reads (`GET /anchor/:hash`,
   `GET /anchorstatus`), and a `POST /api/tx` broadcast override that forwards
   raw transactions to the block producers (the committee mesh does not relay
   externally submitted transactions). These are configured by `FAUCET_CLI`,
   `FAUCET_DATADIR`, `FAUCET_WALLET`, `FAUCET_AMOUNT`, `PRODUCER_DATADIR(S)`,
   `BROADCAST_DATADIR`, `FEERATES_CLI`/`FEERATES_DATADIR`, and
   `ANCHOR_CLI`/`ANCHOR_DATADIR`; the defaults are the production box's node
   paths. Without a local node these endpoints fail cleanly and the static
   site + API proxies still work.
4. **Backends**: the two electrs indexers live in the separate
   [`sequentia-electrs`](https://github.com/GracedEternalKingCabbageMan/sequentia-electrs)
   repo: `run-electrs-supervised.sh` (Sequentia, REST on `:3003`) and
   `run-electrs-testnet4.sh` (Bitcoin testnet4, REST on `:3004`). The frontend
   talks to them only over HTTP, so there is no build-time dependency between
   the repos.

## Release downloads (`/download`)

`serve-public.js` serves `$DOWNLOAD_DIR` (default `downloads/` in this repo)
at `/download`. The landing page (`downloads/index.html`) and its images are
committed; the release artifacts it links (node/wallet tarballs and
installers, the Fulmen AppImage, the Ambra APK) are **not** committed - drop
them beside `index.html` at deploy time, or point `DOWNLOAD_DIR` at a
persistent location such as `/srv/downloads`.

## systemd user services (`deploy/systemd/*.service`)

Three reference units, written for a deployment where this repo is cloned at
`~/sequentia-explorer` and `sequentia-electrs` at `~/sequentia-electrs`
(adjust the absolute paths in the units if your layout differs):

- `concatena-electrs-seq.service`: the Sequentia electrs under its
  crash-wiping supervisor (`run-electrs-supervised.sh`), with a persistent
  database at `~/.local/share/concatena-explorer/seq-db`.
- `concatena-electrs-t4.service`: the Bitcoin testnet4 electrs
  (`run-electrs-testnet4.sh`).
- `concatena-explorer.service`: `serve-public.js` on `:8080`, wanting the two
  electrs units.

Install and start:

```sh
cp deploy/systemd/concatena-*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now concatena-electrs-seq concatena-electrs-t4 concatena-explorer
```

User units start at **login**; to have them start at **boot**, enable
lingering once: `sudo loginctl enable-linger $USER`.

## Public exposure

Put any TLS terminator in front of `:8080`. The production site uses a Caddy
reverse proxy on the server that owns https://sequentiatestnet.com. For an
ad-hoc public deployment from a workstation, Tailscale Funnel also works:

```sh
sudo tailscale set --operator=$USER          # one-time, so funnel needs no sudo
tailscale funnel --bg --https=8443 8080      # -> https://<host>.<tailnet>.ts.net:8443
```

(Funnel must be enabled for the tailnet in its admin console.)

> The **nodes** (`bitcoind` for testnet4, the Sequentia node/producers) are
> not managed by these units - they must be running for their electrs and the
> node-backed helper endpoints to work.
