// Production server for the public explorer: serves the static build in
// esplora/dist (Sequentia at /, Bitcoin testnet4 at /testnet4/) and proxies the
// REST API to the local electrs instances. Run behind a Tailscale Funnel (or any
// TLS terminator) pointed at $PORT. No build tooling at runtime.
//
//   SEQ_ELECTRS=127.0.0.1:3003 T4_ELECTRS=127.0.0.1:3004 PORT=8080 \
//     DOWNLOAD_DIR=/path/to/release/artifacts node serve-public.js
//
// NOTE: requires Express 4 (the SPA '*' route below uses the v4 path syntax;
// Express 5 changed wildcard handling). See explorer/package.json.
const express = require('express')
const { intersectAtMinimum } = require('./feerates')
const http = require('http')
const path = require('path')

const DIST = path.join(__dirname, 'esplora', 'dist')
const SEQ_ELECTRS = process.env.SEQ_ELECTRS || '127.0.0.1:3003'
const T4_ELECTRS = process.env.T4_ELECTRS || '127.0.0.1:3004'
const SEQ_REGISTRY = process.env.SEQ_REGISTRY || '127.0.0.1:3005' // Sequentia Asset Registry
const SEQ_PRICES = process.env.SEQ_PRICES || '127.0.0.1:8088'      // market-data feed (per-asset base prices)
const SEQ_DEX = process.env.SEQ_DEX || '127.0.0.1:9945'           // SeqDEX daemon (Trade + cross-chain Xchain /v1/*)
const SEQ_SEQOB = process.env.SEQ_SEQOB || '127.0.0.1:9955'       // SeqOB order-book relay (/v1/offers, orderbook, /v1/lift) + WS /v1/ws
// THE OTHER RELAYS THE UNIFIED BOOK MERGES. The book shows offers from several
// relays, but a TAKE is an interactive courier session that must be opened against
// the relay actually HOLDING the offer — anywhere else answers "offer not found or
// not open". Proxying only :9955 meant every matched submarine / pure-LN offer was
// visible and unliftable. Same mount convention, one path per relay, WS included.
const SEQ_SEQOB_PLN = process.env.SEQ_SEQOB_PLN || '127.0.0.1:9965'     // submarine + pure-LN makers
const SEQ_SEQOB_SUBAS = process.env.SEQ_SEQOB_SUBAS || '127.0.0.1:9971' // sub-asset SELL makers
// The sub-asset BUY relay (:9966) had NO mount at all, so every offer resting on it was
// visible in the unified book and impossible to lift from a browser: the courier fell
// through to the default mount and dialled the wrong relay, which answers "offer not
// found or not open". That is the rail where the taker pays BTC on-chain and receives
// the asset over Lightning — unreachable from the web wallet for want of one line.
const SEQ_SEQOB_SUBASBUY = process.env.SEQ_SEQOB_SUBASBUY || '127.0.0.1:9966'
// Mount path -> upstream, for both the HTTP proxy and the WS upgrade handler.
const SEQOB_RELAYS = { '/seqob': SEQ_SEQOB, '/seqob-pln': SEQ_SEQOB_PLN, '/seqob-subas': SEQ_SEQOB_SUBAS, '/seqob-subasbuy': SEQ_SEQOB_SUBASBUY }
const PORT = process.env.PORT || 8080
// Optional release-artifact downloads served at /download (Linux tarball,
// Windows installer, landing page). Defaults to ./downloads next to this file.
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(__dirname, 'downloads')
// The SWK WebAssembly browser wallet served at /wallet (index.html + built
// pkg/). Defaults to ./wallet next to this file.
const WALLET_DIR = process.env.WALLET_DIR || path.join(__dirname, 'wallet')

// The Sequentia CLI, used for tx broadcast forwarding, fee-rate reads, anchor
// status and the mempool sweep below.
const { execFile } = require('child_process')
const SEQ_CLI = process.env.SEQ_CLI || '/root/Sequentia/src/sequentia-cli'

// Broadcast forwarding (see below): the PoS committee mesh doesn't relay externally-
// submitted txs to producers, so we push raw Sequentia txs straight to a producer.
// One or more producers to forward to (comma-separated datadirs). The first is
// the primary used by POST /api/tx; the backstop forwards to all of them.
const PRODUCER_DATADIR = process.env.PRODUCER_DATADIR || '/root/seq-testnet/node000'
const PRODUCER_DATADIRS = (process.env.PRODUCER_DATADIRS || PRODUCER_DATADIR)
  .split(',').map(s => s.trim()).filter(Boolean)
const BROADCAST_DATADIR = process.env.BROADCAST_DATADIR || '/root/sequentia/explorer-node'
const TXHEX_RE = /^[0-9a-fA-F]{2,400000}$/
const TXID_RE = /^[0-9a-f]{64}$/i
// Backstop: cap how many times a single tx is re-forwarded before we give up,
// so a permanently-unacceptable tx isn't retried forever (and the map evicted).
const BACKSTOP_MAX_ATTEMPTS = Number(process.env.BACKSTOP_MAX_ATTEMPTS || 30)
const backstopAttempts = new Map()                                // txid -> attempt count

const proxyTo = target => {
  const [host, port] = target.split(':')
  return (req, res) => {
    const headers = { ...req.headers, host: target }
    delete headers['accept-encoding']
    const up = http.request(
      { host, port: port || 80, method: req.method, path: req.url || '/', headers },
      r => { res.writeHead(r.statusCode, r.headers); r.pipe(res) }
    )
    up.on('error', e => { if (!res.headersSent) res.status(502); res.end('electrs proxy error: ' + e.message) })
    req.pipe(up)
  }
}

const app = express()
app.disable('x-powered-by')
// One trusted hop (the TLS terminator / Tailscale Funnel in front of us): trust
// exactly one proxy so req.ip is the real client, not a spoofable X-Forwarded-For.
app.set('trust proxy', 1)

// API proxies first (the /testnet4 prefix is stripped by the mount, so the
// upstream electrs sees /blocks/... etc). Order matters: /testnet4/api before /api.
app.use('/testnet4/api', proxyTo(T4_ELECTRS))

// Sequentia tx broadcast. The PoS committee mesh does not relay externally-submitted
// transactions to block producers, so a tx that only reaches the explorer node's mempool
// is never mined. Push the raw tx straight to a producer (which accepts, mines and relays
// it) plus the explorer node (so electrs indexes it immediately), and return the txid like
// esplora's POST /tx. GET /api/tx/:txid (queries) still falls through to electrs below.
// The hex is validated to [0-9a-f] so it can only ever be one argv element to sequentia-cli.
// BTC (/testnet4/api/tx) is untouched above — it relays on the real testnet4 network.
app.post('/api/tx', express.text({ type: () => true, limit: '500kb' }), (req, res) => {
  const rawhex = String(req.body || '').trim()
  if (!TXHEX_RE.test(rawhex)) return res.status(400).type('text').send('invalid transaction hex')
  const send = (dd, cb) => execFile(SEQ_CLI, ['-datadir=' + dd, 'sendrawtransaction', rawhex], { timeout: 25000 }, cb)
  // Recover the txid of the submitted hex without relying on stdout (the
  // "already in block chain" branch returns an empty stdout) and without parsing
  // the error string (it has none). The explorer node already has the tx, so
  // decoderawtransaction of the submitted hex yields the canonical txid.
  const recoverTxid = cb => execFile(SEQ_CLI, ['-datadir=' + BROADCAST_DATADIR, 'decoderawtransaction', rawhex],
    { timeout: 10000 }, (e, so) => {
      if (e) return cb(null)
      let d; try { d = JSON.parse(so) } catch { return cb(null) }
      cb(d && TXID_RE.test(String(d.txid || '')) ? String(d.txid) : null)
    })
  // Succeed if EITHER the producer or the explorer node accepts the tx. Capture
  // the explorer-node result (don't drop it on a no-op callback).
  let replied = false
  const reply = (status, body) => { if (replied) return; replied = true; res.status(status).type('text').send(body) }
  send(PRODUCER_DATADIR, (perr, pstdout, pstderr) => {
    send(BROADCAST_DATADIR, (berr, bstdout, bstderr) => {
      const pout = String(pstdout || '').trim()
      const bout = String(bstdout || '').trim()
      const out = TXID_RE.test(pout) ? pout : (TXID_RE.test(bout) ? bout : '')
      const emsg = String(pstderr || (perr && perr.message) || bstderr || (berr && berr.message) || '')
      if (out) return reply(200, out)                                  // accepted by either -> txid
      if (/already in (block chain|mempool)|txn-already/i.test(emsg))  // benign re-broadcast: recover the txid
        return recoverTxid(txid => txid ? reply(200, txid) : reply(400, 'broadcast accepted but txid unavailable'))
      reply(400, emsg.trim().split('\n').pop() || 'broadcast failed')
    })
  })
})

app.use('/api', proxyTo(SEQ_ELECTRS))

// Sequentia Asset Registry (asset metadata). Mount strips /registry, so the
// upstream sees /index.minimal.json, /<assetid>, /health, POST /, etc.
app.use('/registry', proxyTo(SEQ_REGISTRY))

// Market-data feed (per-asset base/USD prices), used by all UIs for the
// user-chosen reference-currency valuation. A direct route (not a mount) so the
// path is NOT stripped: GET /prices -> upstream /prices. Public, read-only.
app.get('/prices', proxyTo(SEQ_PRICES))

// SeqDEX daemon: same-origin /dex -> :9945. Mount strips /dex, so the upstream
// sees /v1/markets, /v1/trade/*, /v1/xchain/* (and the reverse /v1/xchain/reverse/*).
app.use('/dex', proxyTo(SEQ_DEX))

// SeqOB order-book relay: same-origin /seqob -> :9955. Mount strips /seqob, so the
// upstream sees /v1/offers, /v1/market/{base}/{quote}/orderbook, /v1/lift. The WS
// courier /v1/ws is proxied via the server 'upgrade' handler below (proxyTo is HTTP-only).
app.use('/seqob', proxyTo(SEQ_SEQOB))
// The sibling relays, same convention (see SEQOB_RELAYS).
app.use('/seqob-pln', proxyTo(SEQ_SEQOB_PLN))
app.use('/seqob-subasbuy', proxyTo(SEQ_SEQOB_SUBASBUY))   // registered before the shorter sibling
app.use('/seqob-subas', proxyTo(SEQ_SEQOB_SUBAS))

// Compages bridge (Ethereum <-> Sequentia): same-origin /bridge -> :9950.
// The compages daemon serves both its web UI (at /) and its API (at /api/*);
// the mount strips /bridge, so the daemon sees / and /api/*. The bare /bridge
// is redirected to /bridge/ so the UI's relative asset/API URLs resolve under
// the prefix. The web app resolves its API from its own module URL, so it works
// behind this prefix unchanged.
const SEQ_BRIDGE = process.env.SEQ_BRIDGE || '127.0.0.1:9950'
// Express routing is non-strict, so '/bridge' also matches '/bridge/'; only the
// slash-less form needs the redirect (redirecting '/bridge/' would loop).
app.get('/bridge', (req, res, next) => {
  if (req.path === '/bridge') return res.redirect(301, '/bridge/')
  next()
})
app.use('/bridge', proxyTo(SEQ_BRIDGE))

// Release-artifact downloads + landing page (before the SPA fallback so
// /download/* is served from DOWNLOAD_DIR, not the esplora index.html).
app.use('/download', express.static(DOWNLOAD_DIR))

// SWK browser wallet (static page + WebAssembly pkg/; express serves .wasm with
// the application/wasm MIME). Before the SPA fallback so /wallet/* is its own.
// The wallet is a live-deployed app: `no-cache` makes every load REVALIDATE
// against the box (ETag/304 keeps repeat loads cheap) instead of the browser's
// heuristic freshness, which kept users on a stale swap.js for hours after a
// deploy — bugs stayed "fixed on the box, broken in the browser".
app.use('/wallet', express.static(WALLET_DIR, {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}))

// Testnet faucet: same-origin /faucet -> :9960, served by the sequentia-faucet
// repo. The mount strips /faucet, so the service sees GET / for its page and
// POST / for a send, while callers keep the unchanged GET /faucet and
// POST /faucet. It used to live in this file; a faucet is not an explorer.
const SEQ_FAUCET = process.env.SEQ_FAUCET || '127.0.0.1:9960'
app.use('/faucet', proxyTo(SEQ_FAUCET))

// Fee-asset exchange rates (Sequentia any-asset-fees): GET /feerates returns the
// node's EFFECTIVE acceptance set {("bitcoin"|assetHex): rate} via getfeeexchangerates
// — i.e. static + non-stale dynamic rates, exactly what the node accepts for fees right
// now (stale dynamic entries are already dropped). The wallet uses these to let users
// pay a Sequentia tx fee in a non-policy asset. No user input → no injection surface;
// short-cached since rates move ~per block.
const FEERATES_CLI = process.env.FEERATES_CLI || SEQ_CLI
// THE NODES WE ACTUALLY BROADCAST TO. /feerates used to read ONE node (the
// explorer's), while POST /api/tx submits to the producer AND the explorer. Two
// daemons, two independent rate tables, coupled only by the price-server sidecar
// happening to feed both. Anything the wallet offered on the strength of the
// explorer's table could be refused by the producer, and the user got a generic
// "min relay fee not met" with nothing to act on.
//
// So this list must stay identical to the broadcast targets above. It is derived
// from the same constants for exactly that reason.
const FEERATES_DATADIRS = (process.env.FEERATES_DATADIRS
  ? process.env.FEERATES_DATADIRS.split(',').map(s => s.trim()).filter(Boolean)
  : [PRODUCER_DATADIR, BROADCAST_DATADIR])

const cliJson = (datadir, method, cb) =>
  execFile(FEERATES_CLI, ['-datadir=' + datadir, method], { timeout: 10000 }, (err, stdout) => {
    if (err) return cb(err)
    try { cb(null, JSON.parse(stdout)) } catch (e) { cb(e) }
  })

// Read one node's acceptance set, KEYED BY ASSET HEX.
//
// getfeeexchangerates keys by asset LABEL where the node has one and by hex
// otherwise, and labels are per-node configuration. Intersecting the raw maps
// would therefore compare a label on one node against a hex on another and
// silently produce an EMPTY intersection — which, now that an unlisted asset is
// simply not accepted, would take the whole fee market off the wallet. So every
// key is normalised through that node's own dumpassetlabels before comparison.
const nodeRatesByHex = (datadir, cb) => {
  cliJson(datadir, 'dumpassetlabels', (lerr, labels) => {
    if (lerr) return cb(lerr)
    const toHex = new Map(Object.entries(labels || {}))
    cliJson(datadir, 'getfeeexchangerates', (rerr, rates) => {
      if (rerr) return cb(rerr)
      const out = new Map()
      for (const [key, rate] of Object.entries(rates || {})) {
        const hex = toHex.get(key) || (/^[0-9a-f]{64}$/i.test(key) ? key.toLowerCase() : null)
        if (!hex) continue                       // a label this node cannot resolve is not comparable
        const n = Number(rate)
        if (Number.isFinite(n) && n > 0) out.set(hex, n)   // a 0 rate is listed but refused: not accepted
      }
      // Keep this node's preferred display key so the response shape does not change.
      const label = new Map()
      for (const [k, hex] of toHex) label.set(hex, k)
      cb(null, { rates: out, label })
    })
  })
}

let feeratesCache = { at: 0, body: null }
app.get('/feerates', (req, res) => {
  if (feeratesCache.body && Date.now() - feeratesCache.at < 15000) return res.type('json').send(feeratesCache.body)
  let pending = FEERATES_DATADIRS.length
  const results = []
  let failed = false
  FEERATES_DATADIRS.forEach((datadir, i) => {
    nodeRatesByHex(datadir, (err, r) => {
      if (!err) results[i] = r
      else failed = true
      if (--pending) return
      // Every node we broadcast to must answer. A node we cannot read is a node
      // that might refuse the fee, and publishing a set we cannot stand behind is
      // exactly the failure this endpoint exists to prevent.
      if (failed || results.filter(Boolean).length !== FEERATES_DATADIRS.length)
        return res.status(502).json({ error: 'fee rates unavailable' })

      const body = JSON.stringify(intersectAtMinimum(results), null, 2)
      feeratesCache = { at: Date.now(), body }
      res.type('json').send(body)
    })
  })
})

// Anchor read (Sequentia's Bitcoin-anchor view) for the wallet's cross-chain
// MAKER anchor gate: a secret-holding reverse maker must SELF-DERIVE a Sequentia
// block's anchor height before revealing its secret (the esplora REST API does
// not surface the custom anchor_height header field). Read-only node RPC. The
// block hash is strictly validated so it can only ever be one argv element.
const ANCHOR_CLI = process.env.ANCHOR_CLI || SEQ_CLI
const ANCHOR_DATADIR = process.env.ANCHOR_DATADIR || BROADCAST_DATADIR
app.get('/anchor/:hash', (req, res) => {
  const h = String(req.params.hash || '')
  if (!/^[0-9a-f]{64}$/.test(h)) return res.status(400).json({ error: 'bad block hash' })
  execFile(ANCHOR_CLI, ['-datadir=' + ANCHOR_DATADIR, 'getblockheader', h, 'true'], { timeout: 10000 }, (err, stdout) => {
    if (err) return res.status(502).json({ error: 'anchor unavailable' })
    try {
      const hdr = JSON.parse(stdout)
      res.json({ anchorheight: hdr.anchorheight, anchorhash: hdr.anchorhash, height: hdr.height, confirmations: hdr.confirmations,
                 poscertified: hdr.poscertified, poscountersigs: hdr.poscountersigs, posquorum: hdr.posquorum })
    } catch { res.status(502).json({ error: 'anchor parse' }) }
  })
})
let anchorStatusCache = { at: 0, body: null }
app.get('/anchorstatus', (req, res) => {
  if (anchorStatusCache.body && Date.now() - anchorStatusCache.at < 5000) return res.type('json').send(anchorStatusCache.body)
  execFile(ANCHOR_CLI, ['-datadir=' + ANCHOR_DATADIR, 'getanchorstatus'], { timeout: 10000 }, (err, stdout) => {
    if (err) return res.status(502).json({ error: 'anchorstatus unavailable' })
    anchorStatusCache = { at: Date.now(), body: stdout }
    res.type('json').send(stdout)
  })
})

// Landing / greeting page for the Sequentia demo server: lists what's available.
const LANDING_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sequentia: testnet demo server</title>
<link rel="icon" href="/explorer/img/icons/SequentiaTestnet-menu-logo.svg">
<style>
  :root{color-scheme:dark}
  body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1216;color:#e8eaed;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .wrap{max-width:720px;padding:48px 24px;width:100%}
  .brand{display:flex;align-items:center;gap:14px;margin:0 0 8px}
  .brand img{height:52px;width:52px}
  h1{font-size:30px;margin:0} h1 .t{color:#f5b301}
  .sub{color:#9aa0a6;margin:0 0 32px}
  .grid{display:grid;gap:16px}
  a.card{display:block;text-decoration:none;color:inherit;background:#171b21;border:1px solid #262b33;border-radius:12px;padding:20px 22px;transition:border-color .15s,transform .05s}
  a.card:hover{border-color:#f5b301;transform:translateY(-1px)}
  .card h2{margin:0 0 4px;font-size:19px;color:#fff} .card p{margin:0;color:#9aa0a6;font-size:14px}
  footer{margin-top:32px;border-top:1px solid #262b33;padding-top:20px;color:#6b7280;font-size:13px}
  .by{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
  .by span{color:#9aa0a6} .by a{color:#f5b301;text-decoration:none} .by a:hover{text-decoration:underline}
  .by img{height:18px;width:auto;vertical-align:middle;opacity:.92}
</style></head><body><div class="wrap">
  <div class="brand">
    <img src="/explorer/img/icons/SequentiaTestnet-menu-logo.svg" alt="Sequentia">
    <h1>Sequentia <span class="t">testnet</span></h1>
  </div>
  <p class="sub">A Bitcoin sidechain: Bitcoin anchoring, a BLS proof-of-stake committee, and an open any-asset fee market. This is the public demo server.</p>
  <div class="grid">
    <a class="card" href="/explorer/"><h2>Block Explorer →</h2><p>Browse Sequentia blocks, transactions and issued assets (and the Bitcoin testnet4 parent chain).</p></a>
    <a class="card" href="/wallet/"><h2>Web Wallet →</h2><p>A self-custodial browser wallet: receive, send any asset, pay fees in any asset, and stake.</p></a>
    <a class="card" href="/pools/"><h2>Staking Pools &rarr;</h2><p>Every block producer on the Sequentia network: the stake lent to it, how reliably it produces, and what it has committed on-chain to paying its delegators. Delegate from any wallet; your coins never move.</p></a>
    <a class="card" href="/dex/"><h2>SeqDEX →</h2><p>The disintermediated exchange of the Sequentia testnet: pure Lightning swaps on the LNDEX, atomic on-chain and covenant orders, a confidential book, and a marketplace for Lightning channel liquidity. Trades are signed by Ambra for Chromium, the browser extension wallet.</p></a>
    <a class="card" href="/faucet"><h2>Faucet →</h2><p>Free testnet coins: tSEQ and sample assets (USDX, EURX, GOLD, SILVR, OILX), sent straight to any address — full node, desktop, mobile or web wallet.</p></a>
    <a class="card" href="/emissio/"><h2>Emissio Rewards →</h2><p>The community issue register: earn Sequence tokens (SEQ), paid at mainnet launch, for completing testnet tasks, winning competitions and reporting vulnerabilities.</p></a>
    <a class="card" href="/bridge/"><h2>Compages Bridge →</h2><p>Bridge into the Sequentia network from Ethereum (Sepolia: ether or any ERC-20), Bitcoin (testnet4: BTC to SBTC) and Solana (devnet: SOL or any SPL token); a deposit mints a Sequentia asset, a return releases the original.</p></a>
    <a class="card" href="/lending/"><h2>Pignus Lending →</h2><p>Borrow one issued asset against another, with the loan’s terms compiled into a covenant the network enforces: nobody holds your collateral, nobody can change the deal after you agree it, and repaying needs no one’s permission. Native Bitcoin can be the collateral too, on the parent chain, bound to the debt by an adaptor signature rather than a covenant.</p></a>
    <a class="card" href="/levo/"><h2>Levo Launchpad →</h2><p>Back new projects on Sequentia, or raise funds for your own: staked Sequence sets how much you can put into a sale, and a covenant holds the project's tokens from the moment they are locked until a buyer's transaction pays the treasury and takes them, in one step.</p></a>
    <a class="card" href="/seqpal/"><h2>SeqPal Issuance →</h2><p>Tokenize and service compliant securities on Sequentia: structure an offering, issue a restricted asset whose transfer rules the policy server enforces at co-sign, and run the transfer-agent lifecycle. A proof of concept.</p></a>
    <a class="card" href="/seqpal/id"><h2>SeqPal ID →</h2><p>One verified identity for issuing and holding SeqPal-managed restricted assets: create a SeqPal ID, carry your eligibility categories, and use them wherever these assets are accepted.</p></a>
    <a class="card" href="/download/"><h2>Downloads →</h2><p>Sequentia Core, the full node and desktop wallet, and Fulmen, a SeqLN Lightning node with a desktop GUI, both for Linux and Windows. Ambra, the dual-chain Bitcoin and Sequentia wallet, for Android and for Chromium.</p></a>
  </div>
  <footer>
    <div class="by">
      <span>Built by</span>
      <a href="https://concatenalabs.com" target="_blank" rel="noopener"><img src="/explorer/img/icons/concatena-labs.png" alt="Concatena Labs"></a>
      <span>·</span>
      <a href="https://sequentia.io" target="_blank" rel="noopener">sequentia.io</a>
    </div>
    Testnet only; assets carry no value.
  </footer>
</div></body></html>`;


// Greeting page at the site root.
app.get('/', (req, res) => res.type('html').send(LANDING_HTML))


// Static assets (serves dist/explorer/**, dist/testnet4/**). express.static itself redirects the
// bare /explorer -> /explorer/ and serves dist/explorer/index.html for /explorer/.
app.use(express.static(DIST))

// SPA fallbacks: client-side routes (e.g. /explorer/block/<hash>) -> the right index.html.
app.get('/explorer/*', (req, res) => res.sendFile(path.join(DIST, 'explorer', 'index.html')))
app.get('/testnet4/*', (req, res) => res.sendFile(path.join(DIST, 'testnet4', 'index.html')))
app.get('*', (req, res) => res.redirect('/')) // unknown path -> greeting

// Backstop: every 20s, forward any still-unbroadcast tx in the explorer node's mempool to
// a producer, so nothing sits unmined even if it arrived before this server started or via
// a path other than POST /api/tx. txids come from the node's own mempool, never from users.
setInterval(() => {
  execFile(SEQ_CLI, ['-datadir=' + BROADCAST_DATADIR, 'getrawmempool', 'true'], { timeout: 15000 }, (err, stdout) => {
    if (err) return
    let m; try { m = JSON.parse(stdout) } catch { return }
    const live = new Set(Object.keys(m))
    // Evict bookkeeping for txs that have left the mempool (mined or dropped).
    for (const txid of backstopAttempts.keys()) if (!live.has(txid)) backstopAttempts.delete(txid)
    for (const [txid, info] of Object.entries(m)) {
      if (!info || !info.unbroadcast) continue
      const attempts = backstopAttempts.get(txid) || 0
      if (attempts >= BACKSTOP_MAX_ATTEMPTS) {                          // give up: likely permanently unacceptable
        if (attempts === BACKSTOP_MAX_ATTEMPTS) {                       // log once, then stop touching it
          console.warn(`backstop: dropping ${txid} after ${attempts} forward attempts`)
          backstopAttempts.set(txid, attempts + 1)
        }
        continue
      }
      backstopAttempts.set(txid, attempts + 1)
      execFile(SEQ_CLI, ['-datadir=' + BROADCAST_DATADIR, 'getrawtransaction', txid], { timeout: 15000 }, (e, hex) => {
        if (e || !hex) return
        const raw = String(hex).trim()
        for (const dd of PRODUCER_DATADIRS)                             // forward to every configured producer
          execFile(SEQ_CLI, ['-datadir=' + dd, 'sendrawtransaction', raw], { timeout: 20000 }, () => {})
      })
    }
  })
}, 20000)

const server = http.createServer(app)

// Proxy WebSocket upgrades for the SeqOB lift courier: /seqob/v1/ws -> :9955/v1/ws.
// proxyTo() above is HTTP-only; the order-book lift is an interactive WS exchange,
// so we hand the raw upgraded socket through to seqobd and pipe both directions.
server.on('upgrade', (req, socket, head) => {
  // Route to the relay whose mount this is. Longest mount first, so /seqob-pln is
  // not swallowed by the /seqob prefix.
  const mount = Object.keys(SEQOB_RELAYS)
    .sort((a, b) => b.length - a.length)
    .find((m) => req.url && req.url.startsWith(m + '/'))
  if (!mount) { socket.destroy(); return }
  const upstream = SEQOB_RELAYS[mount]
  const upstreamPath = req.url.slice(mount.length) || '/'   // strip the mount, mirroring app.use
  const [host, port] = upstream.split(':')
  const up = http.request({
    host, port: port || 80, method: req.method, path: upstreamPath,
    headers: { ...req.headers, host: upstream },
  })
  up.on('upgrade', (upRes, upSocket, upHead) => {
    let resp = `HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}\r\n`
    for (let i = 0; i < upRes.rawHeaders.length; i += 2) resp += `${upRes.rawHeaders[i]}: ${upRes.rawHeaders[i + 1]}\r\n`
    socket.write(resp + '\r\n')
    if (upHead && upHead.length) socket.write(upHead)
    upSocket.pipe(socket); socket.pipe(upSocket)
    upSocket.on('error', () => socket.destroy())
    socket.on('error', () => upSocket.destroy())
  })
  up.on('error', () => socket.destroy())
  if (head && head.length) up.write(head)
  up.end()
})

server.listen(PORT, () =>
  console.log(`explorer (static+proxy) on :${PORT}  /api->${SEQ_ELECTRS}  /testnet4/api->${T4_ELECTRS}  /dex->${SEQ_DEX}  /seqob->${SEQ_SEQOB} (+ws)  /download->${DOWNLOAD_DIR}  /wallet->${WALLET_DIR}  /faucet->${SEQ_FAUCET}`))
