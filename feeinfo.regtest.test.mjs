// GET /feeinfo end to end, on a local chain kept congested: a Sequentia node on
// a fresh elementsregtest chain with blocks shrunk to a few transactions, a
// steady stream of payments at mixed fee rates arriving faster than blocks can
// take them, and this server reading the node exactly as it reads the
// broadcast targets on the public site.
//
// It checks what a wallet relies on: that an idle chain reports the floor, that
// a congested one reports a full block, a price and the estimator's history,
// and — the point of the whole endpoint — that a payment sent at each fee level
// confirms within the blocks that level promised.
//
//   SEQUENTIA_BIN=/path/to/Sequentia/src node --test feeinfo.regtest.test.mjs
//
// Without SEQUENTIA_BIN the test is skipped. Needs `npm install` (Express) for
// serve-public.js. Everything it makes is in a temporary directory, removed at
// the end, and every process it starts is stopped. FEEINFO_REGTEST_KEEP=1 keeps
// the directory and prints where it is, for reading the node's log afterwards.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BIN = process.env.SEQUENTIA_BIN

// Room for about six ordinary payments (~1300 weight each, measured): 4000 of
// the weight is held back for the coinbase. A startup option, so the chain is funded on full-size blocks first
// and the node restarted with it — funding under the small limit would congest
// the setup itself.
const SMALL_BLOCK = 12000
// The queue is held between these depths, in blocks: deep enough that the next
// block is a real auction, shallow enough to stay a market rather than a flood.
// Arrivals are steered to it from the block's measured capacity, because a
// fixed rate is either under capacity (the queue drains and nothing competes)
// or over it (a 46-block backlog, where every estimate collapsed onto the same
// top-of-range price) — both seen with fixed rates.
const DEPTH_MIN = 2, DEPTH_MAX = 4
// Arrival fee rates, reference atoms per vbyte, log-uniform over two decades
// above the relay floor (0.1/vB).
const RATE_MIN = 0.12, RATE_MAX = 20
const HISTORY_BLOCKS = 150
const TRIALS = 3
const MAX_WAIT = 30

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
})
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until (what, f, ms = 120000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) {
    try { const v = await f(); if (v) return v } catch (e) {}
  }
  throw new Error(`timed out waiting for ${what}`)
}
// Seeded, so a run that fails can be replayed exactly.
function prng (seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('the fee levels keep their promise on a congested chain', { skip: !BIN && 'set SEQUENTIA_BIN', timeout: 3600000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explorer-feeinfo-'))
  const stops = []
  t.after(async () => {
    for (const stop of stops.reverse()) { try { await stop() } catch (e) {} }
    if (process.env.FEEINFO_REGTEST_KEEP) t.diagnostic(`kept ${dir}`)
    else fs.rmSync(dir, { recursive: true, force: true })
  })
  const seed = Number(process.env.FEEINFO_REGTEST_SEED || 20261007)
  const random = prng(seed)
  t.diagnostic(`seed ${seed}`)

  // The chain. Coins from a block subsidy, as contract-labels.regtest does.
  const [p2p, rpcPort, explorerPort] = await Promise.all([freePort(), freePort(), freePort()])
  const datadir = path.join(dir, 'node')
  fs.mkdirSync(datadir)
  fs.writeFileSync(path.join(datadir, 'elements.conf'), [
    'chain=elementsregtest', '[elementsregtest]', 'server=1', 'listen=0', `port=${p2p}`, `rpcport=${rpcPort}`,
    'rpcbind=127.0.0.1', 'rpcallowip=127.0.0.1', 'rpcuser=local', 'rpcpassword=local',
    'initialfreecoins=0', 'con_blocksubsidy=100000000000000', 'con_nsubsidyhalvinginterval=1000000',
    'blindedaddresses=0', 'con_default_blinded_addresses=0', 'validatepegin=0', 'con_parent_chain_signblockscript=51',
    'con_any_asset_fees=1', 'par=1', 'maxtxfee=100', 'txindex=1',
    // The fee rules a producer runs by default: the relay floor is NOT lowered,
    // because the levels are measured against the real one.
    // Only confirmed coins are spent, so every payment is independent of the
    // others: a chain of unconfirmed parents is ranked as one package, and the
    // estimator ignores a transaction whose parent is still in the mempool.
    'spendzeroconfchange=0',
    // The expensive index check, on: cheap on a chain this short, and it is what
    // catches a block-index fault the rest of the test would not see.
    'checkblockindex=1',
    // The queue is never trimmed or aged out during the run.
    'maxmempool=300', 'mempoolexpiry=336',
    // With the index check on, a block takes long enough that requests queue up
    // behind it; the default depth of 16 rejects some.
    'rpcworkqueue=256', 'rpcthreads=8', '',
  ].join('\n'))
  const url = `http://127.0.0.1:${rpcPort}/wallet/w`
  const auth = 'Basic ' + Buffer.from('local:local').toString('base64')
  let id = 0
  const rpc = async (method, params = []) => {
    const r = await fetch(url, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '1.0', id: ++id, method, params }) })
    const b = await r.json()
    if (b.error) throw new Error(`${method}: ${b.error.message}`)
    return b.result
  }
  const start = async (extra = []) => {
    const log = fs.openSync(path.join(dir, 'node.log'), 'a')
    const p = spawn(path.join(BIN, 'sequentiad'), [`-datadir=${datadir}`, ...extra], { stdio: ['ignore', log, log] })
    const stop = () => new Promise(r => { if (p.exitCode !== null) return r(); p.once('exit', r); rpc('stop').catch(() => p.kill()) })
    stops.push(stop)
    await until('the node', () => fetch(url, { method: 'POST', headers: { authorization: auth },
      body: JSON.stringify({ id: 0, method: 'getblockcount', params: [] }) }).then(r => r.ok))
    return stop
  }

  let stopNode = await start()
  await rpc('createwallet', ['w'])
  const policy = (await rpc('getsidechaininfo')).pegged_asset
  const addr = await rpc('getnewaddress')
  // Mines n blocks; once blocks are small, a full one also tells us how many
  // payments a block holds (null until then: funding blocks are full-size).
  let capacity = null
  const mine = async n => {
    const hashes = await rpc('generatetoaddress', [n, addr])
    const last = await rpc('getblock', [hashes[hashes.length - 1], 1])
    if (capacity !== null && last.weight > SMALL_BLOCK - 2000 && last.nTx > 1) capacity = last.nTx - 1
    return hashes
  }
  // The policy asset is valued like any other fee asset, at one reference atom
  // per atom, and pushed the way a price server pushes it (not persisted).
  const setRates = () => rpc('setfeeexchangerates', [{ [policy]: 100000000 }, false])
  await setRates()
  await mine(120)

  // Enough independent coins for every payment the run makes.
  for (let i = 0; i < 16; i++) {
    const amounts = {}
    for (let j = 0; j < 100; j++) amounts[await rpc('getnewaddress')] = 1
    await rpc('sendmany', { dummy: '', amounts, fee_asset: policy })
    await mine(1)
  }
  await mine(1)

  // Only now does the block get small.
  await stopNode()
  stopNode = await start([`-blockmaxweight=${SMALL_BLOCK}`, '-wallet=w'])
  await setRates()

  // The explorer, reading this node as it reads the broadcast targets.
  const cli = path.join(BIN, 'sequentia-cli')
  const server = spawn(process.execPath, [path.join(HERE, 'serve-public.js')], {
    stdio: ['ignore', fs.openSync(path.join(dir, 'explorer.log'), 'a'), fs.openSync(path.join(dir, 'explorer.log'), 'a')],
    env: { ...process.env, PORT: String(explorerPort), SEQ_CLI: cli, FEERATES_CLI: cli, FEERATES_DATADIRS: datadir,
      PRODUCER_DATADIR: datadir, BROADCAST_DATADIR: datadir, FEEINFO_CACHE_MS: '0',
      SEQ_ELECTRS: '127.0.0.1:9', T4_ELECTRS: '127.0.0.1:9', DOWNLOAD_DIR: path.join(dir, 'downloads') },
  })
  stops.push(() => new Promise(r => { if (server.exitCode !== null) return r(); server.once('exit', r); server.kill() }))
  const feeinfo = async () => {
    const r = await fetch(`http://127.0.0.1:${explorerPort}/feeinfo`)
    assert.equal(r.status, 200, await r.clone().text())
    return r.json()
  }
  await until('the explorer', () => feeinfo())

  // An idle chain: nothing to compete with, so every level is the next block,
  // and no history to estimate from.
  let info = await feeinfo()
  assert.equal(info.next_block_full, false)
  assert.equal(info.floor, 100, 'the default relay floor')
  assert.deepEqual(info.estimates, { 2: null, 3: null, 6: null, 12: null })
  for (const [name, level] of Object.entries(info.tiers)) assert.equal(level.blocks, 1, name)

  // Traffic: payments at log-uniform rates, a few per block.
  const dest = await rpc('getnewaddress')
  const pay = feeRate => rpc('sendtoaddress', { address: dest, amount: 0.001, fee_rate: feeRate, fee_asset_label: policy, replaceable: true })
  capacity = 6
  const arrive = async () => {
    const depth = (await rpc('getmempoolcongestion')).backlog_blocks
    const steer = depth < DEPTH_MIN ? 2 : depth > DEPTH_MAX ? -2 : 0
    const n = Math.max(0, capacity + steer + Math.floor(random() * 3) - 1)
    for (let i = 0; i < n; i++) {
      const r = RATE_MIN * Math.pow(RATE_MAX / RATE_MIN, random())
      await pay(Math.round(r * 1000) / 1000)
    }
  }
  for (let b = 0; b < HISTORY_BLOCKS; b++) { await arrive(); await mine(1) }
  await arrive()

  info = await feeinfo()
  t.diagnostic(`congested: ${JSON.stringify({ next_block: info.next_block, backlog_blocks: info.backlog_blocks, mempool_txs: info.mempool_txs, estimates: info.estimates })}`)
  assert.equal(info.next_block_full, true, 'the queue must not fit in one block')
  assert.ok(info.next_block > info.floor, 'a full block prices entry above the floor')
  assert.ok(info.backlog_blocks > 1)
  assert.ok(info.estimates[2] !== null || info.estimates[3] !== null, `the estimator has history: ${JSON.stringify(info.estimates)}`)
  const order = ['low', 'medium', 'high', 'highest']
  for (let i = 1; i < order.length; i++) assert.ok(info.tiers[order[i]].feerate > info.tiers[order[i - 1]].feerate)

  // The promise. Each level, several times, against a queue that keeps filling:
  // read /feeinfo, pay at the level, and count the blocks until it confirms.
  const results = []
  for (let trial = 0; trial < TRIALS; trial++) {
    for (const name of order) {
      // The market keeps arriving every block, including the ones a trial
      // waits on: a queue left to drain would measure an idle chain.
      await arrive()
      info = await feeinfo()
      const level = info.tiers[name]
      const txid = await pay(level.feerate / 1000)
      let took = null
      for (let b = 1; b <= MAX_WAIT; b++) {
        await mine(1)
        if ((await rpc('gettransaction', [txid])).confirmations > 0) { took = b; break }
        await arrive()
      }
      results.push({ name, feerate: level.feerate, promised: level.blocks, took, next_block: info.next_block, full: info.next_block_full })
    }
  }
  for (const r of results) t.diagnostic(`${r.name.padEnd(7)} ${String(r.feerate).padStart(6)} atoms/kvB  promised ${r.promised ?? 'none'}  took ${r.took ?? `>${MAX_WAIT}`}  (cut ${r.next_block}${r.full ? ', full' : ''})`)
  // The trials have to be measured against a full block, or they prove nothing.
  assert.ok(results.every(r => r.full), `every trial must start on a full block: ${JSON.stringify(results)}`)

  // A level that promised a number must keep it. Estimates are probabilistic,
  // so one miss in TRIALS is allowed for the levels the estimator priced; the
  // queue-priced ones (promised 1, above the cut) are not allowed to miss.
  for (const name of order) {
    const runs = results.filter(r => r.name === name && r.promised !== null)
    const kept = runs.filter(r => r.took !== null && r.took <= r.promised).length
    const allowed = runs.every(r => r.promised === 1) ? 0 : 1
    assert.ok(runs.length - kept <= allowed, `${name}: kept ${kept} of ${runs.length} promises — ${JSON.stringify(runs)}`)
  }
  // And a level that promised nothing is the cheap end of a full queue.
  for (const r of results.filter(r => r.promised === null)) assert.equal(r.name, 'low', JSON.stringify(r))
})
