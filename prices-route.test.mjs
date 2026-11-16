// /prices serves the price server's /api/prices, cached, and nothing else of it.
//   node --test prices-route.test.mjs
import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import { createRequire } from 'node:module';
const { pricesRoute } = createRequire(import.meta.url)('./prices-route.js');

const upstream = (handler) => new Promise(r => {
  const s = http.createServer(handler).listen(0, '127.0.0.1', () => r(s));
});
const reply = () => {
  const o = { code: 0, body: '', headers: {} };
  o.status = c => { o.code = c; return o; };
  o.type = t => { o.headers['Content-Type'] = t; return o; };
  o.set = (k, v) => { o.headers[k] = v; return o; };
  o.send = b => { o.body = String(b); o.done = true; return o; };
  return o;
};

test('reads the mapped path, serves it, caches it, and keeps serving it when the source dies', async () => {
  const seen = [];
  const s = await upstream((q, r) => { seen.push(q.url); r.setHeader('content-type', 'application/json'); r.end('{"USDC.E":{"price":1}}'); });
  let t = 1000;
  const h = pricesRoute('127.0.0.1:' + s.address().port, '/api/prices', () => t);
  let o = reply(); await h({}, o);
  assert.equal(o.code, 200); assert.deepEqual(seen, ['/api/prices']);
  assert.equal(JSON.parse(o.body)['USDC.E'].price, 1);
  o = reply(); await h({}, o); assert.equal(seen.length, 1, 'cached inside the window');
  t += 11000; await new Promise(r => s.close(r));
  o = reply(); await h({}, o);
  assert.equal(o.code, 200, 'last good body stays served'); assert.equal(JSON.parse(o.body)['USDC.E'].price, 1);
});

test('answers 502 when the source is down and nothing was ever cached', async () => {
  const h = pricesRoute('127.0.0.1:1', '/api/prices');
  const o = reply(); await h({}, o);
  assert.equal(o.code, 502);
});
