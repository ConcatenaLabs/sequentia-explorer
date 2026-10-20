// The contract views end to end, on a local chain: the regtest harness of
// sequentia-contracts takes a loan into a vault (the `l1` test: taken, topped
// up, repaid in part, liquidated in part twice, called, and two more loans
// repaid and recovered), sequentia-electrs indexes the chain and decodes it
// against the template the registry verified, and this explorer, built and
// served by serve-public.js, is rendered in headless Chromium. A spend's page
// must name the template and the path and show the state the next coin holds;
// the contract's page must show every spend in order with the state after it.
//
//   SEQUENTIA_REPO=/path/to/Sequentia \
//   CONTRACTS_DIR=/path/to/sequentia-contracts SEQC=/path/to/seqc \
//   ELECTRS=/path/to/sequentia-electrs/target/debug/electrs \
//   REGISTRY_DIR=/path/to/sequentia-registry CHROME=/path/to/chrome \
//   node --test contract-views.regtest.test.mjs
//
// SEQUENTIA_REPO is a built Sequentia checkout (src/sequentiad and its
// functional test framework), SEQC the contracts repository's `seqc`, ELECTRS
// built with `--features sequentia`. Without all six the test is skipped. It
// builds the Sequentia explorer into esplora/dist/explorer, as build-public.sh
// does; every other file it makes is in a temporary directory, removed at the
// end, and every process it starts is stopped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const env = ['SEQUENTIA_REPO', 'CONTRACTS_DIR', 'SEQC', 'ELECTRS', 'REGISTRY_DIR', 'CHROME']
const missing = env.filter(k => !process.env[k])
const E = Object.fromEntries(env.map(k => [k, process.env[k]]))

const VAULT_CMR = '5fbca220e82362f0896b29d49812f244ca0ac30209e3d74429700e75b9ed2649'

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
// `selector` is in its DOM: the innerText of every `textSelector` match.
async function render (url, selector, textSelector, dir) {
  const profile = fs.mkdtempSync(path.join(dir, 'chrome-'))
  const proc = spawn(E.CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
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
    ws.close()
    return texts
  } finally {
    proc.kill()
    await new Promise(r => proc.exitCode !== null ? r() : proc.once('exit', r))
  }
}

test('the explorer decodes a vault\'s spends and follows its state from spend to spend', { skip: missing.length > 0 && `set ${missing.join(', ')}`, timeout: 1200000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explorer-contract-views-'))
  const stops = []
  t.after(async () => {
    for (const stop of stops.reverse()) { try { await stop() } catch (e) {} }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  })
  const daemon = (name, cmd, args, opts = {}) => {
    const log = fs.openSync(path.join(dir, name + '.log'), 'a')
    const p = spawn(cmd, args, { stdio: ['ignore', log, log], ...opts })
    stops.push(() => new Promise(r => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill() }))
    return p
  }
  const repo = E.SEQUENTIA_REPO

  // The chain: the harness's vault test, its data directory kept.
  const config = path.join(dir, 'config.ini')
  fs.writeFileSync(config, `[environment]\nPACKAGE_NAME=Sequentia Core\nSRCDIR=${repo}\nBUILDDIR=${repo}\nEXEEXT=\nRPCAUTH=${repo}/share/rpcauth/rpcauth.py\n\n[components]\nENABLE_WALLET=true\nUSE_SQLITE=true\nUSE_BDB=true\nENABLE_CLI=true\nENABLE_WALLET_TOOL=true\nENABLE_BITCOIND=true\n`)
  execFileSync('python3', [path.join(E.CONTRACTS_DIR, 'harness', 'tests', 'l1_pignus_vault.py'), `--configfile=${config}`,
    `--tmpdir=${path.join(dir, 'l1')}`, `--cachedir=${path.join(dir, 'cache')}`, '--nocleanup'], { stdio: 'ignore', env: {
    ...process.env, BITCOIND: path.join(repo, 'src', 'sequentiad'), BITCOINCLI: path.join(repo, 'src', 'sequentia-cli'),
    SEQC: E.SEQC, HARNESS_RECORDS: path.join(dir, 'records'), PYTHONDONTWRITEBYTECODE: '1',
  } })

  // The node again, on the chain the test left. The test ran on a clock of its
  // own (setmocktime), so the node runs on that clock too.
  const datadir = path.join(dir, 'l1', 'node0')
  const debug = fs.readFileSync(path.join(datadir, 'elementsregtest', 'debug.log'), 'utf8')
  const clock = [...debug.matchAll(/mocktime: (\S+?Z)/g)].pop()
  const [rpc, p2p, http, electrum, monitoring, registryPort, explorerPort] = await Promise.all(Array.from({ length: 7 }, freePort))
  daemon('node', path.join(repo, 'src', 'sequentiad'), [`-datadir=${datadir}`, `-rpcport=${rpc}`, `-bind=127.0.0.1:${p2p}`,
    '-rpcuser=local', '-rpcpassword=local', '-anyonecanspendaremine=1', '-blindedaddresses=0', '-con_any_asset_fees=1',
    '-con_default_blinded_addresses=0', '-con_parent_chain_signblockscript=51', '-evbparams=simplicity:-1:::',
    '-initialfreecoins=2100000000000000', '-par=1', '-txindex=1', '-validatepegin=0',
    ...(clock ? [`-mocktime=${Math.floor(Date.parse(clock[1]) / 1000) + 60}`] : [])])
  const cli = (...a) => execFileSync(path.join(repo, 'src', 'sequentia-cli'), [`-rpcport=${rpc}`, '-rpcuser=local', '-rpcpassword=local', ...a]).toString().trim()
  const height = await until('the node', async () => cli('getblockcount'), 60000)

  // The registry, holding the vault's template, verified by seqc.
  const registry = `http://127.0.0.1:${registryPort}`
  fs.writeFileSync(path.join(dir, 'no-seed.json'), '[]')
  daemon('registry', process.execPath, [path.join(E.REGISTRY_DIR, 'server.js')], { env: {
    ...process.env, PORT: String(registryPort), DB_DIR: path.join(dir, 'registry-db'), SEED_FILE: path.join(dir, 'no-seed.json'),
    SEQ_ELECTRS_URL: `http://127.0.0.1:${http}`, ADMIN_TOKEN: 'local', SEQC: E.SEQC, CONTRACTS_CHAIN: 'elementsregtest',
    SEQC_HELPERS: path.join(E.CONTRACTS_DIR, 'helpers'),
  } })
  await until('the registry', async () => (await fetch(`${registry}/health`)).ok, 30000)
  const tdir = path.join(E.CONTRACTS_DIR, 'templates', 'pignus_vault')
  const r = await fetch(`${registry}/admin/contracts`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer local' },
    body: JSON.stringify({
      descriptor: fs.readFileSync(path.join(tdir, 'descriptor.json'), 'utf8'),
      sources: { 'pignus_vault.simf': execFileSync(E.SEQC, ['expand', path.join(tdir, 'pignus_vault.simf')], { env: { ...process.env, SEQC_HELPERS: path.join(E.CONTRACTS_DIR, 'helpers') } }).toString() },
      vectors: fs.readFileSync(path.join(tdir, 'vectors.json'), 'utf8'),
      publisher: { domain: 'sequentiatestnet.com' },
    }) })
  assert.equal(r.status, 200, await r.clone().text())
  assert.equal((await r.json()).verified, true)

  // The indexer, which reads the template from the registry.
  const api = `http://127.0.0.1:${http}`
  daemon('electrs', E.ELECTRS, ['--network', 'liquidregtest', '--parent-network', 'regtest', '--no-bitcoin-anchor',
    '--daemon-dir', path.join(datadir, 'elementsregtest'), '--daemon-rpc-addr', `127.0.0.1:${rpc}`, '--cookie', 'local:local',
    '--jsonrpc-import', '--db-dir', path.join(dir, 'electrs-db'), '--http-addr', `127.0.0.1:${http}`,
    '--electrum-rpc-addr', `127.0.0.1:${electrum}`, '--monitoring-addr', `127.0.0.1:${monitoring}`, '--contract-registry-url', registry])
  await until('electrs to index the chain', async () => (await (await fetch(`${api}/blocks/tip/height`)).text()) === height, 300000)
  await until('electrs to hold the vault template', async () =>
    (await (await fetch(`${api}/contracts/templates`)).json()).templates.some(x => x.name === 'pignus/vault'), 120000)

  // The index: every spend of the vault's commitment root, each decoded.
  const { spends } = await (await fetch(`${api}/contracts/${VAULT_CMR}/spends`)).json()
  assert.deepEqual(spends.map(s => s.path), ['top_up', 'repay', 'liquidate', 'liquidate', 'repay', 'liquidate', 'recover'])
  assert.ok(spends.every(s => s.template.name === 'pignus/vault' && s.instance))
  const liquidation = spends[2]
  const d = await (await fetch(`${api}/tx/${liquidation.txid}/contracts`)).json()
  const i = d.inputs[0]
  assert.equal(i.recomputed, true)
  assert.equal(i.cost.wu, 1653)
  assert.equal(i.budget.wu, 13466)
  // The harness's clock follows the wall clock, so times differ from run to
  // run; the amounts do not.
  const [debt, last] = i.successors[0].state
  assert.deepEqual([debt.name, BigInt('0x' + debt.hex)], ['DEBT_OUT', 54444444444444n])
  assert.equal(last.name, 'LAST_TIME')
  assert.ok(BigInt('0x' + last.hex) > BigInt('0x' + i.state[1].hex), 'the attestation is newer than the last')

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

  // A liquidation's page: the path and template under the input, and the
  // state the next coin holds under the output that carries the vault on.
  const labels = await render(`${site}/tx/${liquidation.txid}?expand`, '.contract-page-link', '.contract-label', dir)
  assert.ok(labels.some(l => l.startsWith('liquidate · pignus/vault v2')), labels.join(' | '))
  assert.ok(labels.some(l => l.startsWith('Next state of input #0 · pignus/vault v2: DEBT_OUT 54444444444444 atoms, LAST_TIME') && l.includes(`(${BigInt('0x' + last.hex)})`)), labels.join(' | '))
  const rows = await render(`${site}/tx/${liquidation.txid}?expand`, '.contract-page-link', '.vin-body-row', dir)
  // (the row titles are styled in capitals, which innerText reflects)
  assert.ok(rows.some(l => /^cost 1,?653 WU of a 13,?466 WU budget/i.test(l)), rows.join(' | '))
  assert.ok(rows.some(l => /^path either<.*→ liquidate$/i.test(l)), 'the witness by name, with the value that selects the path')

  // The contract's page: the loan's coin from spend to spend, with its state.
  const heads = await render(`${site}/contract/${VAULT_CMR}/${liquidation.instance}`, '.contract-chain', '.contract-spend-head strong', dir)
  assert.deepEqual(heads, ['top_up', 'repay', 'liquidate', 'liquidate', 'liquidate', 'repay', 'recover'])
  const next = await render(`${site}/contract/${VAULT_CMR}/${liquidation.instance}`, '.contract-chain', '.contract-kv', dir)
  const debts = next.filter(l => l.startsWith('Next state output')).map(l => (l.match(/DEBT_OUT ([\d,]+) atoms/) || [])[1])
  assert.deepEqual(debts.map(x => x && x.replace(/,/g, '')), ['210000000000000', '160000000000000', '54444444444444', '21447811447812'])
})
