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
const http = require('http')
const path = require('path')

const DIST = path.join(__dirname, 'esplora', 'dist')
const SEQ_ELECTRS = process.env.SEQ_ELECTRS || '127.0.0.1:3003'
const T4_ELECTRS = process.env.T4_ELECTRS || '127.0.0.1:3004'
const SEQ_REGISTRY = process.env.SEQ_REGISTRY || '127.0.0.1:3005' // Sequentia Asset Registry
const SEQ_PRICES = process.env.SEQ_PRICES || '127.0.0.1:8088'      // market-data feed (per-asset base prices)
const PORT = process.env.PORT || 8080
// Optional release-artifact downloads served at /download (Linux tarball,
// Windows installer, landing page). Defaults to ./downloads next to this file.
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(__dirname, 'downloads')
// The SWK WebAssembly browser wallet served at /wallet (index.html + built
// pkg/). Defaults to ./wallet next to this file.
const WALLET_DIR = process.env.WALLET_DIR || path.join(__dirname, 'wallet')

// Testnet faucet: POST /faucet {address} sends FAUCET_AMOUNT tSEQ from a funded
// node wallet to the address. Propagation to the block producers is handled at
// the node level (not here). Rate-limited per address + per IP.
const { execFile } = require('child_process')
const FAUCET_CLI = process.env.FAUCET_CLI || '/root/SequentiaByClaude/src/elements-cli'
const FAUCET_DATADIR = process.env.FAUCET_DATADIR || '/root/seq-testnet/node-gw'
const FAUCET_WALLET = process.env.FAUCET_WALLET || 'livetest'
const FAUCET_AMOUNT = process.env.FAUCET_AMOUNT || '50000'
const FAUCET_COOLDOWN_MS = Number(process.env.FAUCET_COOLDOWN_MS || 3600000)
const FAUCET_ADDR_RE = /^(tb1|tsqb1)[ac-hj-np-z02-9]{20,180}$/   // bech32/blech32 data charset
const faucetSeen = new Map()                                    // key -> last-served epoch ms
const faucetTooSoon = k => { const t = faucetSeen.get(k); return t && (Date.now() - t) < FAUCET_COOLDOWN_MS }
// Evict faucetSeen entries older than the cooldown so the map can't grow
// unbounded (one key per address/IP per asset would otherwise accumulate forever).
setInterval(() => {
  const cutoff = Date.now() - FAUCET_COOLDOWN_MS
  for (const [k, t] of faucetSeen) if (t < cutoff) faucetSeen.delete(k)
}, FAUCET_COOLDOWN_MS).unref()
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
// The hex is validated to [0-9a-f] so it can only ever be one argv element to elements-cli.
// BTC (/testnet4/api/tx) is untouched above — it relays on the real testnet4 network.
app.post('/api/tx', express.text({ type: () => true, limit: '500kb' }), (req, res) => {
  const rawhex = String(req.body || '').trim()
  if (!TXHEX_RE.test(rawhex)) return res.status(400).type('text').send('invalid transaction hex')
  const send = (dd, cb) => execFile(FAUCET_CLI, ['-datadir=' + dd, 'sendrawtransaction', rawhex], { timeout: 25000 }, cb)
  // Recover the txid of the submitted hex without relying on stdout (the
  // "already in block chain" branch returns an empty stdout) and without parsing
  // the error string (it has none). The explorer node already has the tx, so
  // decoderawtransaction of the submitted hex yields the canonical txid.
  const recoverTxid = cb => execFile(FAUCET_CLI, ['-datadir=' + BROADCAST_DATADIR, 'decoderawtransaction', rawhex],
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

// Release-artifact downloads + landing page (before the SPA fallback so
// /download/* is served from DOWNLOAD_DIR, not the esplora index.html).
app.use('/download', express.static(DOWNLOAD_DIR))

// SWK browser wallet (static page + WebAssembly pkg/; express serves .wasm with
// the application/wasm MIME). Before the SPA fallback so /wallet/* is its own.
app.use('/wallet', express.static(WALLET_DIR))

// Testnet faucet. execFile (no shell) + a strict address regex means the user-supplied
// address can't inject anything; it's only ever an argv element. The optional `asset` is
// validated against a fixed allowlist (label -> amount), so it's injection-safe too.
const FAUCET_ASSETS = { USDX: '10', EURX: '10', GOLD: '10', WBTC: '10', SILVR: '10', OILX: '10' }
app.post('/faucet', express.json({ limit: '4kb' }), (req, res) => {
  const address = String((req.body && req.body.address) || '').trim()
  if (!FAUCET_ADDR_RE.test(address)) return res.status(400).json({ error: 'Enter a valid Sequentia address.' })
  const asset = String((req.body && req.body.asset) || '').trim()   // '' = native tSEQ
  if (asset && !Object.prototype.hasOwnProperty.call(FAUCET_ASSETS, asset))
    return res.status(400).json({ error: 'Unknown faucet asset.' })
  const unit = asset || 'tSEQ'
  const amount = asset ? FAUCET_ASSETS[asset] : FAUCET_AMOUNT
  // req.ip is the trusted client IP (trust proxy=1 above): the single hop's
  // X-Forwarded-For, falling back to the socket address — not user-spoofable.
  const ip = String(req.ip || req.socket.remoteAddress || '').trim()
  if (faucetTooSoon('a:' + unit + ':' + address) || faucetTooSoon('i:' + unit + ':' + ip))
    return res.status(429).json({ error: 'Already funded recently; please wait before requesting again.' })
  const args = ['-datadir=' + FAUCET_DATADIR, '-rpcwallet=' + FAUCET_WALLET, '-named', 'sendtoaddress',
    'address=' + address, 'amount=' + amount, 'fee_rate=2']
  if (asset) args.push('assetlabel=' + asset)
  execFile(FAUCET_CLI, args, { timeout: 30000 },
    (err, stdout, stderr) => {
      if (err) return res.status(502).json({ error: String(stderr || err.message).trim().split('\n').pop() || 'faucet send failed' })
      faucetSeen.set('a:' + unit + ':' + address, Date.now()); faucetSeen.set('i:' + unit + ':' + ip, Date.now())
      res.json({ txid: stdout.trim(), amount, asset: unit })
    })
})

// Fee-asset exchange rates (Sequentia any-asset-fees): GET /feerates returns the
// node's EFFECTIVE acceptance set {("bitcoin"|assetHex): rate} via getfeeexchangerates
// — i.e. static + non-stale dynamic rates, exactly what the node accepts for fees right
// now (stale dynamic entries are already dropped). The wallet uses these to let users
// pay a Sequentia tx fee in a non-policy asset. No user input → no injection surface;
// short-cached since rates move ~per block.
const FEERATES_CLI = process.env.FEERATES_CLI || FAUCET_CLI
const FEERATES_DATADIR = process.env.FEERATES_DATADIR || '/root/sequentia/explorer-node'
let feeratesCache = { at: 0, body: null }
app.get('/feerates', (req, res) => {
  if (feeratesCache.body && Date.now() - feeratesCache.at < 15000) return res.type('json').send(feeratesCache.body)
  execFile(FEERATES_CLI, ['-datadir=' + FEERATES_DATADIR, 'getfeeexchangerates'], { timeout: 10000 },
    (err, stdout) => {
      if (err) return res.status(502).json({ error: 'fee rates unavailable' })
      feeratesCache = { at: Date.now(), body: stdout }
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
    <a class="card" href="/download/"><h2>Downloads →</h2><p>Full node + desktop GUI for Linux and Windows.</p></a>
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
  execFile(FAUCET_CLI, ['-datadir=' + BROADCAST_DATADIR, 'getrawmempool', 'true'], { timeout: 15000 }, (err, stdout) => {
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
      execFile(FAUCET_CLI, ['-datadir=' + BROADCAST_DATADIR, 'getrawtransaction', txid], { timeout: 15000 }, (e, hex) => {
        if (e || !hex) return
        const raw = String(hex).trim()
        for (const dd of PRODUCER_DATADIRS)                             // forward to every configured producer
          execFile(FAUCET_CLI, ['-datadir=' + dd, 'sendrawtransaction', raw], { timeout: 20000 }, () => {})
      })
    }
  })
}, 20000)

app.listen(PORT, () =>
  console.log(`explorer (static+proxy) on :${PORT}  /api->${SEQ_ELECTRS}  /testnet4/api->${T4_ELECTRS}  /download->${DOWNLOAD_DIR}  /wallet->${WALLET_DIR}  /faucet->${FAUCET_AMOUNT} tSEQ from ${FAUCET_WALLET}`))
