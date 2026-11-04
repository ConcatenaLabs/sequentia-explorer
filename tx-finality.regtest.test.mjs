// The finality rows end to end: this explorer, built and served by
// serve-public.js against a running Sequentia electrs, rendered in headless
// Chromium. A transaction in a certified block and one in a block below the
// committee's quorum must each read their certification and their Bitcoin
// anchor in words, the same words the block page uses, with the numbers the
// indexer reports for them.
//
// It runs inside sequentia-electrs' regtest proof (tests/regtest/tx_finality_reorg.py),
// which starts a proof-of-stake chain anchored to a stand-in Bitcoin chain and
// an electrs indexing it, and calls this test with the variables below once it
// holds both kinds of block:
//
//   EXPLORER_CHECK="node --test $PWD/tx-finality.regtest.test.mjs" CHROME=/path/to/chrome \
//   python3 <sequentia-electrs>/electrs/tests/regtest/tx_finality_reorg.py ...
//
// ELECTRS_URL, TX_CERTIFIED, TX_UNCERTIFIED and BLOCK_CERTIFIED come from that
// script; CHROME is a Chromium binary. Without them the test is skipped.
// SCREENSHOT_DIR, when set, keeps a screenshot of each page. It builds the
// Sequentia explorer into esplora/dist/explorer, as build-public.sh does; every
// other file it makes is in a temporary directory, removed at the end, and
// every process it starts is stopped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const env = ['ELECTRS_URL', 'TX_CERTIFIED', 'TX_UNCERTIFIED', 'BLOCK_CERTIFIED', 'CHROME']
const missing = env.filter(k => !process.env[k])
const E = Object.fromEntries(env.map(k => [k, process.env[k]]))

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
})
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until (what, f, ms = 120000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
    try { const v = await f(); if (v) return v } catch (e) {}
  }
  throw new Error(`timed out waiting for ${what}`)
}

// A page rendered in headless Chromium over the DevTools protocol, once
// `selector` is in its DOM: the innerText of every `textSelector` match, and a
// screenshot in `shot` when given.
async function render (url, selector, textSelector, dir, shot) {
  const profile = fs.mkdtempSync(path.join(dir, 'chrome-'))
  const proc = spawn(E.CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', '--window-size=1200,1400', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let err = ''
      proc.stderr.on('data', d => { err += d; const m = err.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]) })
      proc.once('exit', c => reject(new Error('chrome exited ' + c)))
    })
    const page = await until('a Chromium page', async () =>
      (await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/list`)).json()).find(p => p.type === 'page'), 10000)
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise(r => ws.addEventListener('open', r, { once: true }))
    let id = 0
    const waiting = new Map()
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) } })
    const send = (method, params = {}) => new Promise(r => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
    await send('Page.navigate', { url })
    const texts = await until(`${selector} on ${url}`, async () => (await send('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)}) ? [...document.querySelectorAll(${JSON.stringify(textSelector)})].map(e => e.innerText.replace(/\\s+/g, ' ').trim()) : null`,
      returnByValue: true,
    })).result.result.value, 30000)
    if (shot) {
      const { result } = await send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(shot, Buffer.from(result.data, 'base64'))
    }
    ws.close()
    return texts
  } finally {
    proc.kill()
    await new Promise(r => proc.exitCode !== null ? r() : proc.once('exit', r))
  }
}

test('a transaction\'s page and its block\'s page read its finality in the same words', { skip: missing.length > 0 && `set ${missing.join(', ')}`, timeout: 900000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explorer-tx-finality-'))
  const stops = []
  t.after(async () => {
    for (const stop of stops.reverse()) { try { await stop() } catch (e) {} }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  })
  const shots = process.env.SCREENSHOT_DIR
  const api = async p => (await fetch(E.ELECTRS_URL + p)).json()
  const cert = await api(`/tx/${E.TX_CERTIFIED}/status`)
  const uncert = await api(`/tx/${E.TX_UNCERTIFIED}/status`)
  assert.equal(cert.certification.certified, true)
  assert.equal(uncert.certification.certified, false)

  // The explorer, built and served as on the public site.
  const esplora = path.join(HERE, 'esplora')
  execFileSync('./build.sh', ['sequentia-testnet'], { cwd: esplora, stdio: 'ignore', env: {
    ...process.env, PATH: `${esplora}/node_modules/.bin:${esplora}/client/node_modules/.bin:${process.env.PATH}`,
    DEST: 'dist/explorer', BASE_HREF: '/explorer/', API_URL: '/api',
    ASSET_MAP_URL: '/registry/index.minimal.json', CONTRACT_MAP_URL: '/registry/contracts/index.minimal.json',
  } })
  const port = await freePort()
  const log = fs.openSync(path.join(dir, 'explorer.log'), 'a')
  const p = spawn(process.execPath, [path.join(HERE, 'serve-public.js')], { stdio: ['ignore', log, log], env: {
    ...process.env, PORT: String(port), SEQ_ELECTRS: new URL(E.ELECTRS_URL).host, SEQ_REGISTRY: '127.0.0.1:9',
    T4_ELECTRS: '127.0.0.1:9', SEQ_CLI: '/bin/false',
  } })
  stops.push(() => new Promise(r => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill() }))
  const site = `http://127.0.0.1:${port}/explorer`
  await until('the explorer', async () => (await fetch(`${site}/`)).ok, 30000)

  const deep = d => d == 1 ? '1 Bitcoin block deep' : `${d} Bitcoin blocks deep`
  const a = cert.bitcoin_anchor
  // (the row titles are styled in capitals, which innerText reflects)
  const rowsOf = async (url, shot) => render(url, '.seq-finality', '.seq-finality, .seq-anchor', dir, shot && shots && path.join(shots, shot))

  // A transaction in a certified block.
  const txRows = await rowsOf(`${site}/tx/${E.TX_CERTIFIED}`, 'tx-certified.png')
  assert.deepEqual(txRows, [
    `FINALITY Certified No competing Sequentia block can replace the block holding this transaction; it is undone only if Bitcoin drops block #${a.height} from its chain.`,
    `BITCOIN ANCHOR #${a.height} ${deep(a.depth)}`,
  ])

  // Its block's page: the same rows for the block.
  const blockRows = await rowsOf(`${site}/block/${E.BLOCK_CERTIFIED}`, 'block-certified.png')
  assert.deepEqual(blockRows, [
    `FINALITY Certified No competing Sequentia block can replace this block; it is undone only if Bitcoin drops block #${a.height} from its chain.`,
    `BITCOIN ANCHOR #${a.height} ${deep(a.depth)}`,
  ])

  // A transaction in a block below the quorum.
  const u = uncert.certification, ua = uncert.bitcoin_anchor
  const uRows = await rowsOf(`${site}/tx/${E.TX_UNCERTIFIED}`, 'tx-not-certified.png')
  assert.deepEqual(uRows, [
    `FINALITY Not certified ${u.signers} committee signature${u.signers == 1 ? '' : 's'} of the ${u.quorum} needed, so a competing Sequentia block can still replace the block holding this transaction.`,
    `BITCOIN ANCHOR #${ua.height} ${deep(ua.depth)}`,
  ])
  console.log(JSON.stringify({ txRows, blockRows, uRows }, null, 1))
})
