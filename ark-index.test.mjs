// The explorer's reading of the Ark (ark-index.js), on recorded data:
//
// - test/fixtures/ark-live.json: answers of the public testnet's Ark operator (`rounds`,
//   `tree`) and of the explorer API (`/tx`, `/tx/:txid/outspend/:vout`, `/outspends`) for
//   real rounds and the transactions that took their coins onto the chain, exited them,
//   reclaimed their batches or offboarded; recorded by hand from sequentiatestnet.com.
// - test/fixtures/ark-board.json: the Arca covenant's golden vectors of a board, its funding
//   and its owner's conversion (test/make-ark-board-fixture.mjs).
//
// What no live transaction shows yet (a sweep, a coin part way down an unroll) is built from
// the recorded ones, and says so.
//   node --test ark-index.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const ark = createRequire(import.meta.url)('./ark-index.js')

const fixture = name => JSON.parse(readFileSync(new URL(`./test/fixtures/${name}.json`, import.meta.url), 'utf8'))
const live = fixture('ark-live')
const board = fixture('ark-board')

const indexOf = (rounds = live.rounds) => {
  const ix = new ark.ArkIndex()
  for (const r of rounds) ix.putRound(r, r.batches.map(v => live.trees[`${r.txid}:${v}`] || null))
  return ix
}
const reader = (over = {}) => ({
  getTx: async t => live.txs[t] || null,
  outspend: async (t, v) => (`${t}:${v}` in over) ? over[`${t}:${v}`] : live.outspend[`${t}:${v}`],
})
const T = {
  round1: 'c10e089a0781d9d38d0890e5c916dd81b2c7337a2bf501ed2bdbb6d090ae8061',
  unrollBatch: '4f7a0ff11231913b671d06850a2692076453ee8aeb89d84992761f01474afbf2',
  unrollNode: '01e5d994b901887ceb65930242024b7d87c3d46b74eb8e4f6c595f7a887ecc4b',
  unlock: '25ce85ade8e4accade286b48cd8230105b8ed955e9c9c8fd10279e02615ea5d2',
  unlock1: '3b32e79131a7a8b28bc2554176c15dfb0faa224af2214866801e3a7acaac9259',
  exit: 'e6064262ff6c099e1dff47c2d6114a98ddd65e88b845bdf8dbfccba5241e6c62',
  offboard: 'b8a3b09156057495a19e635e630e00b114c6d1e11ccbe0abd9d18f4393ce5407',
  afterOffboard: '6fccfd830a158526960496ce51f6fafc8c347d320cfb41c8b58f694245f41335',
  collab: '1bd52232cbee51e48ad3e6f73e732096718e47d4c38663295ac2a3ee5ab55eb8',
  reclaimBatch: '05bebdfc1981bd385beaa9711efa802588ff93d2f7bf475b4a5199638ef0456e',
  reclaimNode: '012df895d80fd9e4d1b8e5759e47bb5b0119e9989ed2d441bb48a8e9bf20482e',
  partialUnroll: 'ccea8afc409204018c09360cf4652011b85a9dabc6d5e2bba2c2fd778d58f3fe',
  drip: 'ff4e43323076f5bdce6b3b2ba56b68af8001ca6b0b46b829fdc07d69b3da1007',
}

test('every live leaf id recomputes from the place the tree gives it', () => {
  let n = 0
  for (const tree of Object.values(live.trees)) {
    const batch = tree.nodes[tree.nodes.length - 1][0].script_pubkey
    for (const l of ark.treePlaces(tree).leaves) {
      assert.equal(ark.leafId(ark.programOf(batch), l.path, ark.programOf(l.leaf.script_pubkey)), l.leaf.leaf_id)
      n++
    }
  }
  assert.ok(n >= 40, `${n} leaves`)
  // A tree of three levels: the path names a child at each, from the batch output down.
  const deep = Object.values(live.trees).find(t => t.nodes.length == 3)
  const p = ark.treePlaces(deep)
  assert.equal(p.depth, 3)
  assert.deepEqual(p.leaves[0].path.length, 3)
  assert.equal(p.nodes.filter(n => n.kind == 'batch').length, 1)
})

test('the revealed tapscripts of live spends read as their Ark paths', () => {
  const path = (txid, k = 0) => ark.classifyScript(ark.revealedScript(live.txs[txid].vin[k].witness).script)
  assert.equal(path(T.unrollBatch).path, 'unroll')
  assert.equal(path(T.unrollNode).path, 'unroll')
  assert.equal(path(T.reclaimBatch).path, 'reclaim')
  assert.equal(path(T.reclaimNode).path, 'reclaim')
  assert.equal(path(T.exit).path, 'exit')
  assert.equal(path(T.collab).path, 'collab')
  assert.equal(path(T.offboard).path, 'hashlock')
  const unlock = path(T.unlock)
  assert.equal(unlock.path, 'unlock')
  assert.equal('5120' + unlock.leaf_program, live.txs[T.unlock].vout[0].scriptpubkey)
  assert.equal(unlock.asset, live.txs[T.unlock].vout[0].asset)
  assert.equal(Number(unlock.value), live.txs[T.unlock].vout[0].value)
  // A key-path spend and a P2WPKH spend reveal no tapscript.
  assert.equal(ark.revealedScript(live.txs[T.afterOffboard].vin[0].witness), null)
})

test('live transactions get their Ark labels', async () => {
  const ix = indexOf()
  const role = async t => ark.txRole(live.txs[t], ix, {})
  assert.deepEqual(await role(T.round1), { role: 'round', words: 'Ark round', round: 1, round_txid: T.round1 })
  assert.equal((await role(T.unrollBatch)).role, 'unroll')
  assert.equal((await role(T.unrollBatch)).level, 0)
  assert.equal((await role(T.unrollNode)).role, 'unroll')
  assert.equal((await role(T.unrollNode)).level, 1)
  assert.equal((await role(T.partialUnroll)).role, 'unroll')
  const unlock = await role(T.unlock)
  assert.equal(unlock.role, 'unroll')
  assert.equal(unlock.leaf_id, '170d23c78f25440de4f5f0df8582716f776a633486975e62f5e0f0d1059df386')
  const exit = await role(T.exit)
  assert.deepEqual([exit.role, exit.words, exit.round, exit.leaf_id], ['exit', 'Ark exit', 1, '4b8744031811289dc6171ed549f798c3094c24ee035ae99bd7abf1aeb10aaf43'])
  assert.equal((await role(T.collab)).role, 'spend')
  assert.deepEqual([(await role(T.reclaimBatch)).role, (await role(T.reclaimBatch)).level], ['reclaim', 0])
  assert.deepEqual([(await role(T.reclaimNode)).role, (await role(T.reclaimNode)).level], ['reclaim', 1])
  assert.deepEqual([(await role(T.offboard)).role, (await role(T.offboard)).round], ['offboard', 1332])
  // What is not the Ark's: the payment the offboard made, then spent; a faucet drip.
  assert.equal(await role(T.afterOffboard), null)
  assert.equal(await role(T.drip), null)
})

test('an index without the round labels none of its spends', async () => {
  const ix = indexOf(live.rounds.filter(r => r.txid != T.round1))
  for (const t of [T.round1, T.unrollBatch, T.exit, T.collab, T.unlock1]) assert.equal(await ark.txRole(live.txs[t], ix, {}), null, t)
})

test('live coins read in plain words, following their path down', async () => {
  const ix = indexOf()
  const state = async id => { const p = ix.leaves.get(id); return ark.coinState(p, ix.round(p.round), reader()) }
  assert.equal((await state('170d23c78f25440de4f5f0df8582716f776a633486975e62f5e0f0d1059df386')).state, 'onchain')
  const exited = await state('4b8744031811289dc6171ed549f798c3094c24ee035ae99bd7abf1aeb10aaf43')
  assert.deepEqual([exited.state, exited.words, exited.txid], ['exited', 'exited by its owner: taken onto the chain and spent there', T.exit])
  assert.equal((await state('b29c8e6f1f6d9ad1bdc89cc4e7ffc050a04cdcb6a92d6ddc5aad917baca28313')).state, 'spent_onchain')
  // A batch of one coin reclaimed, and a lowest node of a deeper batch reclaimed.
  assert.equal((await state('ef955147f6145b20be2b2b6e848dff7773eb1e8b2a7c411566792b33b0b035db')).state, 'moved_on')
  const node = await state('78d91c96f5fa38b17026be6f3d367e6d6a66cc8123fa26eb77c29235723893af')
  assert.deepEqual([node.state, node.txid], ['moved_on', T.reclaimNode])
  assert.equal((await state('db9a1dbe6aed1041d8892335d8945eb01c46d9f0579afe79e9c870d1b2a30e46')).state, 'lost')
  const newest = live.rounds[live.rounds.length - 1]
  const held = await state(live.trees[`${newest.txid}:${newest.batches[0]}`].leaves[0].leaf_id)
  assert.deepEqual([held.state, held.words], ['held', 'held off the chain in its batch'])
})

test('a coin part way down an unroll, and one swept (built from live answers)', async () => {
  const ix = indexOf()
  // The batch of round 1547 was opened (its output 1 now reclaimed); were output 1 still
  // unspent, a coin under it is on its way onto the chain.
  const id = '780ba193b97fd8469d9d08ce7a7131a5eb5da8c5a52ebd9de924284a8bf7480a'
  const p = ix.leaves.get(id)
  assert.deepEqual(p.path, [1, 0])
  const mid = await ark.coinState(p, ix.round(p.round), reader({ [`${T.partialUnroll}:1`]: { spent: false } }))
  assert.equal(mid.state, 'unrolling')
  assert.equal(mid.txid, T.partialUnroll)
  // A sweep: the batch output spent by its sweep path (the tree's own script layout).
  const sweepScript = '76c85188' + '20' + 'aa'.repeat(32) + '88' + 'ca5188' + '20' + 'bb'.repeat(32) + '88' + '20' + 'cc'.repeat(32) + 'ac'
  assert.equal(ark.classifyScript(sweepScript).path, 'sweep')
  const r = live.rounds.find(x => x.txid == T.round1)
  const batch = live.txs[T.unrollBatch]
  const sweep = { txid: 'ee'.repeat(32), vin: [{ ...batch.vin[0], witness: [ 'ab'.repeat(64), '00', sweepScript, 'c4' + 'dd'.repeat(32) ] }], vout: [{ scriptpubkey: '0014' + '11'.repeat(20), value: 1 }] }
  assert.deepEqual([(await ark.txRole(sweep, ix, {})).role, (await ark.txRole(sweep, ix, {})).words], ['sweep', 'Ark sweep'])
  const leaf = live.trees[`${r.txid}:0`].leaves[0].leaf_id
  const swept = await ark.coinState(ix.leaves.get(leaf), ix.round(r.txid), {
    outspend: async (t, v) => t == r.txid && v == 0 ? { spent: true, txid: sweep.txid } : null,
    getTx: async t => t == sweep.txid ? sweep : null,
  })
  assert.equal(swept.state, 'swept')
})

test('a board is recognised from its conversion and confirmed by the operator', async () => {
  const ix = indexOf()
  const known = { [board.leaf_id]: { leaf_id: board.leaf_id, txid: board.funding.txid, vout: board.board_vout, state: 'credited', finality: 'final' } }
  const opts = {
    board: async id => known[id] || null,
    spenders: async tx => tx.txid == board.funding.txid ? [{ vout: board.board_vout, spender: board.conversion }] : [],
  }
  const conv = await ark.txRole(board.conversion, ix, opts)
  assert.deepEqual([conv.role, conv.words, conv.leaf_id, conv.board_txid, conv.board_vout],
    ['board_onchain', 'Ark board: coin taken onto the chain', board.leaf_id, board.funding.txid, board.board_vout])
  const funding = await ark.txRole(board.funding, ix, opts)
  assert.deepEqual([funding.role, funding.words, funding.leaf_id, funding.converted_by], ['board', 'Ark board', board.leaf_id, board.conversion.txid])
  // The operator knows no such board, or names another outpoint for it: no label.
  assert.equal(await ark.txRole(board.conversion, ix, { ...opts, board: async () => null }), null)
  assert.equal(await ark.txRole(board.conversion, ix, { ...opts, board: async id => ({ ...known[id], vout: 1 }) }), null)
  assert.equal(await ark.txRole(board.funding, ix, { ...opts, board: async () => null }), null)
  // An unspent board shows nothing public to recognise it by.
  assert.equal(await ark.txRole(board.funding, ix, { ...opts, spenders: async () => [] }), null)
})

test('the mirror pages the operator, refreshes rounds not yet final and bounds what it keeps', async () => {
  const rounds = live.rounds.map((r, k) => ({ ...r, cursor: String(k + 1) }))
  rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], state: 'broadcast' }
  const calls = []
  const post = async (call, body) => {
    calls.push([call, body])
    if (call == 'rounds') {
      const after = body.after == null ? 0 : Number(body.after)
      const page = rounds.filter(r => Number(r.cursor) > after).slice(0, body.limit)
      return page.length ? { rounds: page, next: page[page.length - 1].cursor } : { rounds: [] }
    }
    if (call == 'tree') return live.trees[`${body.txid}:${body.vout}`] || null
    throw new Error('unexpected ' + call)
  }
  const m = new ark.ArkMirror({ post, pageSize: 4 })
  await m.sync()
  assert.equal(m.index.rounds.size, rounds.length)
  assert.equal(m.lastError, null)
  assert.equal(calls.filter(c => c[0] == 'tree').length, rounds.reduce((n, r) => n + r.batches.length, 0))
  assert.equal(m.index.round(rounds.length).state, 'broadcast')
  // The next pass reads from the round still open, and its tree again; nothing else.
  calls.length = 0
  rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], state: 'final' }
  await m.sync()
  assert.deepEqual(calls.filter(c => c[0] == 'rounds')[0][1], { after: String(rounds.length - 1), limit: 4 })
  assert.deepEqual(calls.filter(c => c[0] == 'tree').map(c => c[1].txid), rounds[rounds.length - 1].batches.map(() => rounds[rounds.length - 1].txid))
  assert.equal(m.index.round(rounds.length).state, 'final')
  // Every few passes it reads every round's state again: a Bitcoin reorganisation can take a
  // final round out, and the operator then calls it something else.
  const m2 = new ark.ArkMirror({ post, pageSize: 4, fullEvery: 2 })
  await m2.sync()
  rounds[0] = { ...rounds[0], state: 'broadcast' }
  calls.length = 0
  await m2.sync()   // pass 2: from the last round on only
  assert.equal(m2.index.round('1').state, 'final')
  await m2.sync()   // pass 3: every round again
  assert.deepEqual(calls.filter(c => c[0] == 'rounds').slice(-4)[0][1].after, undefined)
  assert.equal(m2.index.round('1').state, 'broadcast')
  assert.ok(calls.some(c => c[0] == 'tree' && c[1].txid == rounds[0].txid))
  rounds[0] = { ...rounds[0], state: 'final' }
  // A round number, a txid and a coin id each find their round.
  const r1 = m.index.round('1')
  assert.equal(m.index.round(r1.txid), r1)
  const leaf = live.trees[`${r1.txid}:${r1.batches[0].vout}`].leaves[0]
  assert.equal(m.index.leaves.get(leaf.leaf_id).round, r1.txid)
  assert.equal(m.index.scripts.get(leaf.script_pubkey).kind, 'leaf')
  // At its bound the index drops its oldest rounds, with their scripts and coins.
  const small = new ark.ArkIndex({ maxRounds: 3 })
  for (const r of rounds) small.putRound(r, r.batches.map(v => live.trees[`${r.txid}:${v}`] || null))
  assert.equal(small.rounds.size, 3)
  assert.equal(small.round('1'), null)
  assert.equal(small.leaves.get(leaf.leaf_id), undefined)
  assert.equal(small.scripts.get(leaf.script_pubkey), undefined)
  // An operator that does not answer leaves the index as it was and says why.
  const down = new ark.ArkMirror({ post: async () => { throw new Error('connection refused') }, index: small })
  await down.sync()
  assert.equal(down.lastError, 'connection refused')
  assert.equal(small.rounds.size, 3)
})

test('round states read in plain words', () => {
  assert.equal(ark.roundStateWords('final'), 'final')
  assert.equal(ark.roundStateWords('broadcast'), 'on the chain, not final yet')
  assert.match(ark.roundStateWords('lost'), /never came to be/)
  const ix = indexOf()
  assert.equal(ark.batchStateWords(null, ix).state, 'held')
  assert.equal(ark.batchStateWords(live.txs[T.reclaimBatch], ix).state, 'reclaimed')
  assert.equal(ark.batchStateWords(live.txs[T.unrollBatch], ix).state, 'unrolled')
})
