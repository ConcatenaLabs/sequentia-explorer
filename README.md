# sequentia-explorer

Sequentia's fork of [Blockstream Esplora](https://github.com/Blockstream/esplora):
the block-explorer frontend for the Sequentia sidechain and its Bitcoin testnet4
parent chain, plus the public-deploy tooling that serves both under one origin.

## Indexer lives in a separate repo

The Rust indexer (electrs) + the vendored `rust-elements` Sequentia decoder were
split into [`sequentia-electrs`](https://github.com/aejkcs50/sequentia-electrs).
This repo is frontend-only; it talks to the indexer over the Esplora REST API
(`/api` → electrs `:3003`, `/testnet4/api` → electrs `:3004`), so there is no
build-time coupling. When the indexer's REST surface changes, update the frontend
here to match.

## Layout

- `esplora/` — the Esplora frontend (fork). Build with `npm install` + `build-public.sh`.
- `build-public.sh` — builds the static site (both flavors, relative links) into
  `esplora/dist/` (`/` Sequentia + `/testnet4/` Bitcoin testnet4).
- `serve-public.js` — serves `dist/`, proxies `/api` and `/testnet4/api` to the
  electrs backends, and serves release artifacts at `/download`. Needs Express 4.
- `run-sequentia-explorer.sh`, `run-testnet4-explorer.sh` — local dev servers.
- `downloads/` — the `/download` landing page (committed; built artifacts are not).
- `deploy/` — production deploy (systemd user services + Tailscale Funnel). The
  electrs units reference the `sequentia-electrs` checkout; see `deploy/README.md`.

## Build

```sh
cd esplora && npm install
cd .. && ./build-public.sh      # -> esplora/dist/
node serve-public.js            # serves dist/ + proxies to electrs
```
