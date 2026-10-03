// The contract labels end to end, on a local chain: a Sequentia node on a fresh
// elementsregtest chain with Simplicity active, a faucet drip covenant funded
// and dripped three times with the drip tool, sequentia-electrs indexing it, the
// registry holding the faucet drip template and its instance, and this
// explorer, built and served by serve-public.js, rendered in headless Chromium.
// Each drip's page must name the template and the spending path, and the
// covenant must be followable from the funding output through every drip.
//
//   SEQUENTIA_BIN=/path/to/Sequentia/src \
//   FAUCET_DRIP=/path/to/sequentia-faucet/drip/target/debug/faucet-drip \
//   ELECTRS=/path/to/sequentia-electrs/target/debug/electrs \
//   REGISTRY_DIR=/path/to/sequentia-registry SEQC=/path/to/seqc \
//   CHROME=/path/to/chrome \
//   node --test contract-labels.regtest.test.mjs
//
// Without all six the test is skipped. It builds the Sequentia explorer into
// esplora/dist/explorer, as build-public.sh does; every other file it makes is
// in a temporary directory, removed at the end, and every process it starts is
// stopped.
//
// The chain's coins come from a block subsidy rather than initialfreecoins:
// sequentia-electrs cannot read the issuance that initialfreecoins puts in a
// custom chain's genesis block (it stops on InvalidConfidentialPrefix(178)).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const env = ['SEQUENTIA_BIN', 'FAUCET_DRIP', 'ELECTRS', 'REGISTRY_DIR', 'SEQC', 'CHROME']
const missing = env.filter(k => !process.env[k])
const E = Object.fromEntries(env.map(k => [k, process.env[k]]))

// Public test mnemonics, never funded anywhere but a local chain.
const FAUCET_MNEMONIC = 'exist carry drive collect lend cereal occur much tiger just involve mean'
const TREASURY_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const DRIP_TEMPLATE = '12986f202fbfb850f7699c5d5188f261f276de6c7038142f0a28bbb672b5af34'

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
// `selector` is in its DOM.
async function render (url, selector, dir) {
  const profile = fs.mkdtempSync(path.join(dir, 'chrome-'))
  const proc = spawn(E.CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let err = ''
      proc.stderr.on('data', d => { err += d; const m = err.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]) })
      proc.once('exit', c => reject(new Error('chrome exited ' + c)))
    })
    const pages = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/list`)).json()
    const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl)
    await new Promise(r => ws.addEventListener('open', r, { once: true }))
    let id = 0
    const waiting = new Map()
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) } })
    const send = (method, params = {}) => new Promise(r => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
    await send('Page.navigate', { url })
    const html = await until(`${selector} on ${url}`, async () => (await send('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)}) ? document.documentElement.outerHTML : ''`, returnByValue: true,
    })).result.result.value, 30000)
    ws.close()
    return html
  } finally {
    proc.kill()
    await new Promise(r => proc.exitCode !== null ? r() : proc.once('exit', r))
  }
}

const text = s => s.replace(/<[^>]+>/g, '').replace(/&rarr;/g, '→').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const labels = html => [...html.matchAll(/<span class="contract-label">(.*?)<\/span>/g)].map(m => text(m[1]))
const nextSpends = html => [...html.matchAll(/<span class="contract-next">(.*?)<\/span>/g)].map(m => {
  const a = m[1].match(/href="tx\/([0-9a-f]{64})\?input:(\d+)"/)
  return a ? [a[1], Number(a[2])] : text(m[1])
})

test('the explorer labels a drip and follows the covenant from drip to drip', { skip: missing.length > 0 && `set ${missing.join(', ')}`, timeout: 900000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explorer-contracts-'))
  const stops = []
  t.after(async () => {
    for (const stop of stops.reverse()) { try { await stop() } catch (e) {} }
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const daemon = (name, cmd, args, opts = {}) => {
    const log = fs.openSync(path.join(dir, name + '.log'), 'a')
    const p = spawn(cmd, args, { stdio: ['ignore', log, log], ...opts })
    stops.push(() => new Promise(r => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill() }))
    return p
  }

  // The chain.
  const [p2p, rpc, http, electrum, monitoring, registryPort, explorerPort] = await Promise.all(Array.from({ length: 7 }, freePort))
  const datadir = path.join(dir, 'node')
  fs.mkdirSync(datadir)
  fs.writeFileSync(path.join(datadir, 'elements.conf'), [
    'chain=elementsregtest', '[elementsregtest]', 'server=1', 'listen=0', `port=${p2p}`, `rpcport=${rpc}`,
    'rpcbind=127.0.0.1', 'rpcallowip=127.0.0.1', 'rpcuser=local', 'rpcpassword=local',
    'initialfreecoins=0', 'con_blocksubsidy=100000000000000', 'con_nsubsidyhalvinginterval=1000000',
    'blindedaddresses=0', 'con_default_blinded_addresses=0', 'validatepegin=0', 'con_parent_chain_signblockscript=51',
    'con_any_asset_fees=1', 'evbparams=simplicity:-1:::', 'par=1', 'fallbackfee=0.0001', 'maxtxfee=100', 'txindex=1', '',
  ].join('\n'))
  const cliPath = path.join(E.SEQUENTIA_BIN, 'sequentia-cli')
  const cli = (...a) => execFileSync(cliPath, [`-datadir=${datadir}`, ...a], { encoding: 'utf8' }).trim()
  const node = spawn(path.join(E.SEQUENTIA_BIN, 'sequentiad'), [`-datadir=${datadir}`], { stdio: 'ignore' })
  stops.push(() => new Promise(r => { if (node.exitCode !== null) return r(); node.once('exit', r); try { cli('stop') } catch (e) { node.kill() } }))
  await until('the node', () => cli('getblockchaininfo'))
  cli('createwallet', 'treasury')
  for (let i = 0; i < 11; i++) cli('generatetoaddress', '100', cli('getnewaddress'))
  const mine = n => cli('generatetoaddress', String(n), cli('getnewaddress'))
  const advance = () => {
    const tip = JSON.parse(cli('getblockheader', cli('getbestblockhash')))
    cli('setmocktime', String(tip.time + 572))
    mine(12)
  }

  // The covenant: funded once, then three drips.
  const tool = (...a) => {
    const r = spawnSync(E.FAUCET_DRIP, [...a], { encoding: 'utf8' })
    assert.equal(r.status, 0, `${a[0]}: ${r.stderr}`)
    return JSON.parse(r.stdout)
  }
  const nodeArgs = ['--cli', cliPath, '--datadir', datadir]
  const keyFile = (name, words) => { const f = path.join(dir, name); fs.writeFileSync(f, words + '\n', { mode: 0o600 }); return f }
  const faucetFile = keyFile('faucet.mnemonic', FAUCET_MNEMONIC)
  const policy = JSON.parse(cli('getsidechaininfo')).pegged_asset
  const instance = tool('instance', '--asset', policy,
    '--faucet-key', tool('key', '--mnemonic-file', faucetFile).faucet_key,
    '--treasury-key', tool('key', '--mnemonic-file', keyFile('treasury.mnemonic', TREASURY_MNEMONIC)).faucet_key,
    '--interval', '1', '--fee-cap', '100000',
    '--tiers', '100000000000000,50000000000,10000000000000,20000000000,1000000000000,2000000000,200000000',
    '--recovery-delay', '2', ...nodeArgs)
  assert.equal(instance.template_hash, DRIP_TEMPLATE)
  const instancePath = path.join(dir, 'instance.json')
  fs.writeFileSync(instancePath, JSON.stringify(instance))
  const covenant = tool('address', '--instance', instancePath).address.elementsregtest
  const funding = cli('-named', 'sendtoaddress', `address=${covenant}`, 'amount=2000000', 'fee_asset_label=bitcoin')
  mine(1)
  const to = cli('getnewaddress', '', 'bech32')
  const drips = []
  for (let i = 0; i < 3; i++) {
    advance()
    drips.push(tool('drip', '--instance', instancePath, '--mnemonic-file', faucetFile, '--to', to, ...nodeArgs).txid)
    mine(1)
  }

  // The indexer.
  const api = `http://127.0.0.1:${http}`
  daemon('electrs', E.ELECTRS, ['--network', 'liquidregtest', '--parent-network', 'regtest',
    '--daemon-dir', path.join(datadir, 'elementsregtest'), '--daemon-rpc-addr', `127.0.0.1:${rpc}`, '--cookie', 'local:local',
    '--jsonrpc-import', '--db-dir', path.join(dir, 'electrs-db'), '--http-addr', `127.0.0.1:${http}`,
    '--electrum-rpc-addr', `127.0.0.1:${electrum}`, '--monitoring-addr', `127.0.0.1:${monitoring}`])
  const height = cli('getblockcount')
  await until('electrs to index the chain', async () => (await (await fetch(`${api}/blocks/tip/height`)).text()) === height, 300000)

  // The registry: the template, by the operator, and the instance, by anyone.
  daemon('registry', process.execPath, [path.join(E.REGISTRY_DIR, 'server.js')], { env: {
    ...process.env, PORT: String(registryPort), DB_DIR: path.join(dir, 'registry-db'), SEED_FILE: path.join(dir, 'no-seed.json'),
    SEQ_ELECTRS_URL: api, ADMIN_TOKEN: 'local', SEQC: E.SEQC, CONTRACTS_CHAIN: 'elementsregtest',
  } })
  const registry = `http://127.0.0.1:${registryPort}`
  await until('the registry', async () => (await fetch(`${registry}/health`)).ok, 30000)
  const fixtures = path.join(E.REGISTRY_DIR, 'test', 'fixtures', 'sequentia-contracts', 'templates', 'faucet_drip')
  const post = async (p, body, admin) => {
    const r = await fetch(registry + p, { method: 'POST', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...(admin ? { authorization: 'Bearer local' } : {}) } })
    const b = await r.json()
    assert.equal(r.status, 200, `${p}: ${JSON.stringify(b)}`)
    return b
  }
  const read = f => fs.readFileSync(path.join(fixtures, f), 'utf8')
  const template = await post('/admin/contracts', { descriptor: read('descriptor.json'), sources: { 'faucet_drip.simf': read('faucet_drip.simf') },
    vectors: read('vectors.json'), publisher: { domain: 'sequentiatestnet.com' } }, true)
  assert.equal(template.verified, true)
  await post(`/contracts/${DRIP_TEMPLATE}/instances`, { params: instance.params, slots: instance.slots, genesis: instance.genesis })

  // The explorer, built and served as on the public site.
  const esplora = path.join(HERE, 'esplora')
  execFileSync('./build.sh', ['sequentia-testnet'], { cwd: esplora, stdio: 'ignore', env: {
    ...process.env, PATH: `${esplora}/node_modules/.bin:${esplora}/client/node_modules/.bin:${process.env.PATH}`,
    DEST: 'dist/explorer', BASE_HREF: '/explorer/', API_URL: '/api',
    ASSET_MAP_URL: '/registry/index.minimal.json', CONTRACT_MAP_URL: '/registry/contracts/index.minimal.json',
  } })
  daemon('explorer', process.execPath, [path.join(HERE, 'serve-public.js')], { env: {
    ...process.env, PORT: String(explorerPort), SEQ_ELECTRS: `127.0.0.1:${http}`, SEQ_REGISTRY: `127.0.0.1:${registryPort}`,
    T4_ELECTRS: '127.0.0.1:9', SEQ_CLI: '/bin/false',
  } })
  const site = `http://127.0.0.1:${explorerPort}/explorer`
  await until('the explorer', async () => (await fetch(`${site}/`)).ok, 30000)

  // The funding output is the registered covenant, and its next spend is the first drip.
  let html = await render(`${site}/tx/${funding}`, '.contract-next', dir)
  assert.deepEqual(labels(html), ['Contract sequentia/faucet-drip v1'])
  assert.deepEqual(nextSpends(html), [[drips[0], 0]])
  // Each drip names the template and the path, and its successor reserve links
  // to the next drip; the last reserve is unspent.
  for (let i = 0; i < drips.length; i++) {
    html = await render(`${site}/tx/${drips[i]}`, '.contract-next', dir)
    assert.deepEqual(labels(html), ['drip · sequentia/faucet-drip v1', 'Next state of input #0 · sequentia/faucet-drip v1'], `drip ${i + 1}`)
    assert.match(html, new RegExp(`href="/registry/contracts/${DRIP_TEMPLATE}"`))
    assert.deepEqual(nextSpends(html), [i + 1 < drips.length ? [drips[i + 1], 0] : 'unspent'], `drip ${i + 1}`)
  }
  t.diagnostic(`funding ${funding}; drips ${drips.join(' -> ')}`)
})
