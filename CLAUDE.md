# sequentia-explorer

The public front door of the Sequentia testnet site. Two things live here:

- `esplora/` — a vendored fork of Blockstream Esplora, the explorer frontend, built to static
  assets under `esplora/dist/{explorer,testnet4}` (gitignored; not source).
- `serve-public.js` — one hand-written Express 4 server (~600 lines) that serves those static
  builds and everything else on the domain: the wallet, the download page, the faucet page, and
  reverse proxies to the indexers, registry, price feed, DEX and order-book relays.

The indexer itself is **not** here; it was split out to
[`sequentia-electrs`](https://github.com/GracedEternalKingCabbageMan/sequentia-electrs).
Node and consensus conventions live in the
[`Sequentia`](https://github.com/GracedEternalKingCabbageMan/Sequentia) repo.

## Build and run

```sh
cd esplora && npm install
cd .. && ./build-public.sh      # -> esplora/dist/{explorer,testnet4}
npm install                     # Express 4, for serve-public.js
node serve-public.js            # default :8080
```

`package.json` has **no `scripts` block** — there is no `npm start` and no `npm test`. The only
automated test is:

```sh
node --test feerates.test.mjs
```

which covers `intersectAtMinimum` in `feerates.js` and nothing else. There is no CI.

`deploy/systemd/` holds the three units (the server plus the two electrs instances) and
`deploy/README.md` documents the environment variables and install steps.

## The faucet is off on purpose

`POST /faucet` returns 503 unconditionally: the handler opens with a `return` and the entire
original faucet body below it is deliberately unreachable, with `GET /faucet` carrying a banner
saying so. It was switched off at the owner's instruction after an automated watchdog destroyed
the treasury wallet's HD seed, leaving the funds behind it permanently unspendable. The reason
is recorded in the code comment above the handler.

Do not re-enable it, do not delete the unreachable code, and do not "repair" it as a drive-by
cleanup.

## Things that break if you get them wrong

- **Express 4 is pinned deliberately.** The SPA fallbacks use the v4 `'*'` wildcard route, which
  Express 5 removed. Upgrading silently breaks routing. The pin is annotated in `package.json`
  and at the top of `serve-public.js`.
- **Route order is load-bearing, and has bitten twice.** Redundant redirects have produced 301
  loops on `/explorer/` and `/bridge` under non-strict routing. Prefix shadowing matters too:
  `/seqob-subasbuy` must be registered before `/seqob-subas`. Static mounts must be registered
  before the SPA fallback or `/download/*` and `/wallet/*` get swallowed by `index.html`.
- **Every order-book relay needs its own mount** *and* an entry in `SEQOB_RELAYS` for the
  WebSocket upgrade. Offers show up in the merged book but are only liftable against the relay
  holding them, so a missing mount fails as "offer not found or not open" rather than as an
  obvious 404.
- **`/wallet` must stay `Cache-Control: no-cache`.** The wallet is live-deployed; heuristic
  freshness produced "fixed on the box, still broken in the browser".
- **Asset ids changed at the 2026-07-05 re-genesis**, and WBTC no longer exists. Old ids in docs
  or fixtures are dead.

## How the pieces connect

- `/wallet` is an `express.static` mount of `WALLET_DIR` (default `./wallet`). There is no
  submodule and no build-time coupling to
  [`sequentia-web-wallet`](https://github.com/GracedEternalKingCabbageMan/sequentia-web-wallet);
  the built wallet is simply placed in that directory.
- `/api` and `/testnet4/api` proxy to the two electrs instances; `/registry` proxies to
  [`sequentia-registry`](https://github.com/GracedEternalKingCabbageMan/sequentia-registry);
  `/prices`, `/dex`, `/seqob*` and `/bridge` proxy to their own services.
- The server never speaks JSON-RPC itself. Where it needs the node (broadcast override, fee
  rates, anchor reads, and previously the faucet) it shells out to `elements-cli -datadir=...`
  and inherits the node's cookie auth. That is why no RPC credentials appear anywhere in this
  repo — keep it that way.

## Working in this repo

- **Repository is public.** Never commit keys, seeds, wallet files, RPC credentials, `.env`
  files or tokens. Release artifacts under `downloads/` are not committed either.
- **Commit author:**
  `GracedEternalKingCabbageMan <151803062+GracedEternalKingCabbageMan@users.noreply.github.com>`
- **Always open a pull request, then merge it yourself immediately.** The PR exists so the
  change and its reasoning are recorded, not because anyone is waiting to review it. There is
  no review process. If you are ever told to leave one specific PR open, that applies to that
  PR only and never becomes the default.
- Development happens on `main`, which is also the remote default.
- **Deployment is pull-only.** The server pulls this repo from GitHub and builds there. Never
  edit source on the server and never copy source or binaries onto it.

<!-- BEGIN SHARED AGENT CONVENTIONS: identical in every Sequentia repo. Change it in all of them together. -->
## Working with git and GitHub here

These rules are the same in every Sequentia repository. They are repeated in each
one because this file is the only thing an agent is guaranteed to read, whatever
machine it is working from.

**Nothing pushed to GitHub credits Claude, Anthropic, or any AI tool.** No
`Co-Authored-By: Claude` trailer, no `Claude-Session:` trailer or `claude.ai`
link, no "Generated with Claude Code" in a commit message or a pull request body,
no `claude/*` branch names or session ids, and no mention in source, comments,
docs or issue text. Agent tooling offers several of these by default; compose the
message without them rather than stripping them afterwards.

**Author every commit as**
`GracedEternalKingCabbageMan <151803062+GracedEternalKingCabbageMan@users.noreply.github.com>`.
Never a personal address.

**Every change lands through a pull request that you merge yourself, at once.**
There is no reviewer on this project; the pull request exists so the reasoning is
recorded beside the diff. Branch, push, open it, merge it, delete the branch, all
in one sitting. Pushing straight to the default branch is the rule most often
broken here, and it is the one that costs the record. A pull request stays open
only when the repository owner asks for that specific one, and that never carries
over to the next.

**Name branches `area/short-description`**: `fix/`, `doc/`, `feature/`, `test/`,
`build/`, or the component being changed. Never a tool name, a session id, or
`worktree-*`.

**Write the subject as `area: what changed`**, one line, 72 characters at the
outside and 50 where you can manage it. Put the reasoning in the body, and
explain why rather than what.

**These repositories are public and world-readable.** Never commit private keys,
seeds, `wallet.dat`, RPC credentials, `.env` files or API tokens. Read the diff
before every commit. Secrets belong on the server and in offline backups.

**A file belongs to the repository whose code it describes.** Decide which repo
owns it before writing it; if it landed in the wrong one, move it rather than
deleting it.

**Push the same day you commit.** The testnet server pulls only from GitHub, so a
branch left on one laptop is invisible to every other machine and to the box.
<!-- END SHARED AGENT CONVENTIONS -->
