// The public /prices route: the price server's /api/prices, read from the loopback
// price server and cached briefly. The price server rate-limits per client address,
// and from here every visitor arrives as 127.0.0.1, so the cache is what keeps one
// shared client from exhausting its limit for everybody. Only this one path is
// forwarded: the price server's admin pages are never reachable through it.
const http = require('http')

const TTL_MS = 10000

function pricesRoute (target, upstreamPath, now = Date.now, get = http.get) {
  const [host, port] = target.split(':')
  let cached = null // { at, status, headers, body }
  let inflight = null

  const fetchUpstream = () => new Promise(resolve => {
    const req = get({ host, port: port || 80, path: upstreamPath, headers: { host: target }, timeout: 5000 }, r => {
      const chunks = []
      r.on('data', c => chunks.push(c))
      r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks), type: r.headers['content-type'] }))
      r.on('error', e => resolve({ error: e }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', e => resolve({ error: e }))
  })

  return async (req, res) => {
    if (!cached || now() - cached.at > TTL_MS) {
      inflight = inflight || fetchUpstream().finally(() => { inflight = null })
      const r = await inflight
      if (!r.error && r.status === 200) cached = { at: now(), body: r.body, type: r.type }
      else if (!cached) {
        res.status(502).type('text/plain').send('price feed unavailable')
        return
      } // else: keep serving the last good body
    }
    res.status(200).set('Content-Type', cached.type || 'application/json').send(cached.body)
  }
}

module.exports = { pricesRoute, TTL_MS }
