// The explorer's reading of the Ark: a mirror of the rounds and batch trees an
// Ark operator publishes, and what a transaction on the chain does to them.
//
// The operator's public calls (no authentication) are all this needs:
//
//   POST rounds  {after, limit}  -> {rounds: [{cursor, txid, state, batches: [vout]}], next}
//   POST tree    {txid, vout}    -> a batch's published tree: its asset, its leaves (each
//                                   with its id, template, value and script) and its nodes,
//                                   level by level, the lowest nodes first, the last level
//                                   holding the batch output alone; each node names its
//                                   children as [start, end) in the level below (the
//                                   leaves' entries, for a lowest node)
//   POST board_status {leaf_id}  -> a board: its transaction output, state and finality
//
// The scripts it recognises are the operator's covenant scripts (the Arca covenant crate,
// `covenant/src/{node,sweep,entry,leaf,board}.rs`), read from the tapscript a spend
// reveals:
//
//   UNROLL   a tree node's path that creates its children at outputs 0..r-1; it pushes
//            the tag "Arca/unroll"
//   RECLAIM  a lowest node's path the operator takes once every owner under it signed a
//            release; its first push begins "Arca/release"
//   SWEEP    the path behind the batch's token: OP_DUP OP_INSPECTINPUTASSET OP_1
//            OP_EQUALVERIFY <T> OP_EQUALVERIFY OP_INSPECTINPUTSCRIPTPUBKEY ...
//   UNLOCK   an entry's move into its leaf: OP_SIZE <32> OP_EQUALVERIFY OP_SHA256 <h>
//            OP_EQUALVERIFY, then output 0's asset, value and program; the same hash gate
//            before anything else is an offboard's unlock, on an output of the round itself
//   CONVERT  a board's move into its leaf: <A> OP_CHECKSIGVERIFY, then output 0's asset,
//            value and program
//   EXIT     a leaf's exit: <delay> OP_CHECKSEQUENCEVERIFY OP_DROP <A> OP_CHECKSIG
//   COLLAB   a leaf's path for owner and operator together: OP_SIZE OP_1 OP_EQUALVERIFY ...
//
// No dependency on the rest of the server, so it can be tested on recorded data.
'use strict'
const crypto = require('crypto')

const sha256 = buf => crypto.createHash('sha256').update(buf).digest()

// --- scripts -------------------------------------------------------------------

const OP = {
  OP_0: 0x00, OP_PUSHDATA1: 0x4c, OP_PUSHDATA2: 0x4d, OP_PUSHDATA4: 0x4e, OP_1: 0x51,
  OP_DROP: 0x75, OP_DUP: 0x76, OP_EQUAL: 0x87, OP_EQUALVERIFY: 0x88, OP_SIZE: 0x82,
  OP_SHA256: 0xa8, OP_CHECKSIG: 0xac, OP_CHECKSIGVERIFY: 0xad, OP_CSV: 0xb2,
  OP_INSPECTINPUTASSET: 0xc8, OP_INSPECTINPUTSCRIPTPUBKEY: 0xca,
  OP_INSPECTOUTPUTASSET: 0xce, OP_INSPECTOUTPUTVALUE: 0xcf, OP_INSPECTOUTPUTSCRIPTPUBKEY: 0xd1,
}

// A script as its operations: each {op} or {op, data} for a push. null when it does not parse.
const parseScript = hex => {
  if (typeof hex != 'string' || hex.length % 2 || !/^[0-9a-f]*$/i.test(hex)) return null
  const b = Buffer.from(hex, 'hex'), ops = []
  for (let i = 0; i < b.length;) {
    const op = b[i++]
    let n = -1
    if (op >= 0x01 && op <= 0x4b) n = op
    else if (op == OP.OP_PUSHDATA1) { if (i + 1 > b.length) return null; n = b[i]; i += 1 }
    else if (op == OP.OP_PUSHDATA2) { if (i + 2 > b.length) return null; n = b.readUInt16LE(i); i += 2 }
    else if (op == OP.OP_PUSHDATA4) { if (i + 4 > b.length) return null; n = b.readUInt32LE(i); i += 4 }
    if (n >= 0) {
      if (i + n > b.length) return null
      ops.push({ op, data: b.subarray(i, i + n) }); i += n
    } else ops.push({ op })
  }
  return ops
}

// The tapscript a taproot script-path spend reveals, and its control block; an annex,
// if any, is last. null for a key-path spend, a Simplicity leaf or anything else: the
// control block's first byte must carry Elements' tapscript leaf version, 0xc4, which a
// P2WPKH spend's 33-byte public key of the same length (02 or 03) never does.
const TAPSCRIPT_LEAF = 0xc4
const revealedScript = witness => {
  if (!Array.isArray(witness) || witness.length < 2) return null
  const end = witness.length >= 3 && String(witness[witness.length - 1]).startsWith('50') ? witness.length - 1 : witness.length
  const control = witness[end - 1], script = witness[end - 2]
  if (!control || script == null || control.length < 66 || (control.length - 66) % 64 != 0) return null
  if ((parseInt(control.slice(0, 2), 16) & 0xfe) != TAPSCRIPT_LEAF) return null
  return { script, control }
}

const isPush = (o, len) => o && o.data && (len == null || o.data.length == len)
const isOp = (o, op) => o && !o.data && o.op == op
const UNROLL_TAG = Buffer.from('Arca/unroll')
const RELEASE_TAG = Buffer.from('Arca/release')

// The output-0 pin an entry's unlock and a board's conversion end with, from operation i:
// OP_0 OP_INSPECTOUTPUTASSET OP_1 OP_EQUALVERIFY <asset> OP_EQUALVERIFY
// OP_0 OP_INSPECTOUTPUTVALUE OP_1 OP_EQUALVERIFY <value_le8> OP_EQUALVERIFY
// OP_0 OP_INSPECTOUTPUTSCRIPTPUBKEY OP_1 OP_EQUALVERIFY <leaf program> OP_EQUAL
const outputPin = (ops, i) => {
  if (ops.length != i + 18) return null
  const at = k => ops[i + k]
  const ok = isOp(at(0), OP.OP_0) && isOp(at(1), OP.OP_INSPECTOUTPUTASSET) && isOp(at(2), OP.OP_1) && isOp(at(3), OP.OP_EQUALVERIFY)
    && isPush(at(4), 32) && isOp(at(5), OP.OP_EQUALVERIFY)
    && isOp(at(6), OP.OP_0) && isOp(at(7), OP.OP_INSPECTOUTPUTVALUE) && isOp(at(8), OP.OP_1) && isOp(at(9), OP.OP_EQUALVERIFY)
    && isPush(at(10), 8) && isOp(at(11), OP.OP_EQUALVERIFY)
    && isOp(at(12), OP.OP_0) && isOp(at(13), OP.OP_INSPECTOUTPUTSCRIPTPUBKEY) && isOp(at(14), OP.OP_1) && isOp(at(15), OP.OP_EQUALVERIFY)
    && isPush(at(16), 32) && isOp(at(17), OP.OP_EQUAL)
  if (!ok) return null
  return {
    // The script carries the asset in internal byte order; ids are shown in display order.
    asset: Buffer.from(at(4).data).reverse().toString('hex'),
    value: at(10).data.readBigUInt64LE(0).toString(),
    leaf_program: at(16).data.toString('hex'),
  }
}

// Which Ark path a revealed tapscript is, with what it pins: { path, ... } or null.
const classifyScript = hex => {
  const ops = parseScript(hex)
  if (!ops || !ops.length) return null
  if (ops.some(o => o.data && o.data.equals(UNROLL_TAG))) return { path: 'unroll' }
  if (ops.some(o => o.data && o.data.length >= RELEASE_TAG.length && o.data.subarray(0, RELEASE_TAG.length).equals(RELEASE_TAG)))
    return { path: 'reclaim' }
  if (isOp(ops[0], OP.OP_DUP) && isOp(ops[1], OP.OP_INSPECTINPUTASSET) && isOp(ops[2], OP.OP_1) && isOp(ops[3], OP.OP_EQUALVERIFY)
    && isPush(ops[4], 32) && isOp(ops[5], OP.OP_EQUALVERIFY) && isOp(ops[6], OP.OP_INSPECTINPUTSCRIPTPUBKEY))
    return { path: 'sweep' }
  if (isOp(ops[0], OP.OP_SIZE) && isPush(ops[1], 1) && ops[1].data[0] == 32 && isOp(ops[2], OP.OP_EQUALVERIFY)
    && isOp(ops[3], OP.OP_SHA256) && isPush(ops[4], 32) && isOp(ops[5], OP.OP_EQUALVERIFY)) {
    const pin = outputPin(ops, 6)
    if (pin) return { path: 'unlock', ...pin }
    // The same hash gate in front of anything else: an offboard's unlock, which pins the
    // output at its own input's index by a record hash.
    return { path: 'hashlock' }
  }
  if (isPush(ops[0], 32) && isOp(ops[1], OP.OP_CHECKSIGVERIFY)) {
    const pin = outputPin(ops, 2)
    if (pin) return { path: 'convert', owner: ops[0].data.toString('hex'), ...pin }
  }
  if (ops.length == 5 && isPush(ops[0]) && ops[0].data.length <= 5 && isOp(ops[1], OP.OP_CSV) && isOp(ops[2], OP.OP_DROP)
    && isPush(ops[3], 32) && isOp(ops[4], OP.OP_CHECKSIG))
    return { path: 'exit' }
  if (isOp(ops[0], OP.OP_SIZE) && isOp(ops[1], OP.OP_1) && isOp(ops[2], OP.OP_EQUALVERIFY)) return { path: 'collab' }
  return null
}

// --- leaf ids ------------------------------------------------------------------

const LEAF_ID_TAG = sha256(Buffer.from('Arca/leaf-id'))

// LeafId::compute: the BIP340 tagged hash of the batch output's witness program, the
// number of levels, the index on the path at each level from the batch output down
// (a byte each), and the leaf's witness program.
const leafId = (batchProgram, path, leafProgram) => sha256(Buffer.concat([
  LEAF_ID_TAG, LEAF_ID_TAG, Buffer.from(batchProgram, 'hex'), Buffer.from([path.length]), Buffer.from(path), Buffer.from(leafProgram, 'hex'),
])).toString('hex')

// A board's leaf id is that of a batch of no levels whose batch output is the board output.
const boardLeafId = (boardProgram, leafProgram) => leafId(boardProgram, [], leafProgram)

// The witness v1 program of a scriptPubKey, or null.
const programOf = spk => typeof spk == 'string' && /^5120[0-9a-f]{64}$/i.test(spk) ? spk.slice(4).toLowerCase() : null

// --- one batch's tree ----------------------------------------------------------

// Every place in a published tree: the batch output, each node and each leaf, with its
// level counted from the batch output down (0 is the batch output) and its index in that
// level; each leaf with its path (the index of the child taken at each level, from the
// batch output down) and the scripts of the nodes on it.
const treePlaces = tree => {
  const levels = Array.isArray(tree.nodes) ? tree.nodes : []
  const depth = levels.length
  const leaves = Array.isArray(tree.leaves) ? tree.leaves : []
  const nodes = [], places = []
  levels.forEach((level, k) => level.forEach((n, index) => {
    const lvl = depth - 1 - k // 0 = the batch output
    nodes.push({ kind: lvl == 0 ? 'batch' : 'node', level: lvl, index, lowest: k == 0, script_pubkey: n.script_pubkey, value: n.value })
  }))
  const parentOf = (k, i) => {
    const up = levels[k + 1]
    if (!up) return -1
    return up.findIndex(n => n.children && i >= n.children[0] && i < n.children[1])
  }
  leaves.forEach((leaf, i) => {
    const path = [], scripts = []
    let k = 0, child = i, ok = depth > 0
    while (ok && k < depth) {
      const level = levels[k]
      const j = level.findIndex(n => n.children && child >= n.children[0] && child < n.children[1])
      if (j < 0) { ok = false; break }
      path.unshift(child - level[j].children[0])
      scripts.unshift(level[j].script_pubkey)
      child = j; k += 1
    }
    places.push({ index: i, leaf, path: ok ? path : null, node_scripts: ok ? scripts : null })
  })
  return { depth, nodes, leaves: places }
}

const sumValues = vs => vs.reduce((a, v) => a + BigInt(v || 0), 0n).toString()

// --- the index -----------------------------------------------------------------

const DONE = new Set(['final', 'lost'])

class ArkIndex {
  constructor({ maxRounds = 20000 } = {}) {
    this.maxRounds = maxRounds
    this.rounds = new Map()     // round txid -> round
    this.byNumber = new Map()   // round number -> round txid
    this.scripts = new Map()    // scriptPubKey -> place
    this.leaves = new Map()     // leaf id -> place
    this.outpoints = new Map()  // "txid:vout" of a batch output -> place
  }

  // A round as `rounds` lists it, with the trees of its batches (null where a tree could
  // not be read yet).
  putRound(entry, trees) {
    const old = this.rounds.get(entry.txid)
    if (old) this._drop(old)
    const number = Number(entry.cursor)
    const round = { number, txid: entry.txid, state: entry.state, batches: [] }
    ;(entry.batches || []).forEach((vout, b) => {
      const tree = trees[b]
      const batch = { vout, tree: !!tree, kind: tree ? tree.kind || 'tree' : null, asset: tree ? tree.asset : null, leaves: 0, value: '0', template: {} }
      round.batches.push(batch)
      const at = { round: entry.txid, number, batch_vout: vout, asset: batch.asset }
      this.outpoints.set(`${entry.txid}:${vout}`, { kind: 'batch', ...at, level: 0, index: 0 })
      if (!tree) return
      const { nodes, leaves, depth } = treePlaces(tree)
      batch.depth = depth
      batch.leaves = leaves.length
      batch.value = sumValues(leaves.map(l => l.leaf.value))
      for (const l of leaves) batch.template[l.leaf.template] = (batch.template[l.leaf.template] || 0) + 1
      for (const n of nodes) if (n.script_pubkey) this.scripts.set(n.script_pubkey, { ...at, kind: n.kind, level: n.level, index: n.index, lowest: n.lowest })
      for (const l of leaves) {
        const place = { ...at, kind: 'leaf', index: l.index, leaf_id: l.leaf.leaf_id, template: l.leaf.template, value: l.leaf.value,
          script_pubkey: l.leaf.script_pubkey, path: l.path, node_scripts: l.node_scripts, depth }
        if (l.leaf.script_pubkey) this.scripts.set(l.leaf.script_pubkey, place)
        if (l.leaf.leaf_id) this.leaves.set(l.leaf.leaf_id, place)
      }
    })
    round._trees = trees.map(t => t ? { nodes: t.nodes, leaves: (t.leaves || []).map(l => ({ script_pubkey: l.script_pubkey, leaf_id: l.leaf_id })) } : null)
    this.rounds.set(entry.txid, round)
    this.byNumber.set(number, entry.txid)
    while (this.rounds.size > this.maxRounds) {
      const oldest = Math.min(...this.byNumber.keys())
      this._drop(this.rounds.get(this.byNumber.get(oldest)))
    }
    return round
  }

  _drop(round) {
    if (!round) return
    this.rounds.delete(round.txid)
    if (this.byNumber.get(round.number) == round.txid) this.byNumber.delete(round.number)
    round.batches.forEach((b, i) => {
      this.outpoints.delete(`${round.txid}:${b.vout}`)
      const t = round._trees && round._trees[i]
      if (!t) return
      for (const level of t.nodes || []) for (const n of level) this.scripts.delete(n.script_pubkey)
      for (const l of t.leaves) { this.scripts.delete(l.script_pubkey); this.leaves.delete(l.leaf_id) }
    })
  }

  round(id) {
    const s = String(id)
    if (/^\d+$/.test(s)) return this.rounds.get(this.byNumber.get(Number(s))) || null
    return this.rounds.get(s.toLowerCase()) || null
  }

  // Rounds whose state can still change, and rounds with a tree not read yet.
  unsettled() {
    return [...this.rounds.values()].filter(r => !DONE.has(r.state) || r.batches.some(b => !b.tree))
  }

  lastNumber() { return this.byNumber.size ? Math.max(...this.byNumber.keys()) : 0 }
}

// --- the mirror ------------------------------------------------------------------

// Copies the operator's published rounds and trees into an ArkIndex. `post(call, body)`
// answers the operator's JSON (a promise); the server passes an HTTP client, a test a
// recording. A tree of a round that is final or lost does not change, so it is read once.
// A final round is final only while its Bitcoin anchor stands: a Bitcoin reorganisation
// takes its block out and the operator's state for it changes with no depth limit. So
// every `fullEvery` passes the mirror reads every round's state again (a page per hundred
// rounds) and reads the trees of each round whose state moved.
class ArkMirror {
  constructor({ post, index = new ArkIndex(), pageSize = 100, fullEvery = 20, concurrency = 4, onError = () => {} }) {
    this.post = post; this.index = index; this.pageSize = pageSize; this.fullEvery = fullEvery; this.onError = onError
    this.concurrency = Math.max(1, concurrency) // trees read at once; `post` paces the calls
    this.synced = false; this.lastSync = null; this.lastError = null; this.passes = 0
    this.cursor = null // the number of the last round read in order
  }

  async _trees(entry) {
    const out = []
    for (const vout of entry.batches || []) {
      try {
        const tree = await this.post('tree', { txid: entry.txid, vout })
        out.push(tree && tree.round_txid == entry.txid && tree.batch_vout == vout ? tree : null)
      } catch (e) { this.onError(e); out.push(null) }
    }
    return out
  }

  // One pass: read every round after the lowest one that can still change, and the
  // trees of every round new or changed.
  async sync() {
    const index = this.index
    const unsettled = index.unsettled().map(r => r.number)
    const full = this.passes > 0 && this.passes % this.fullEvery == 0
    this.passes += 1
    let after = full ? null : unsettled.length ? Math.min(...unsettled) - 1 : this.cursor
    try {
      for (;;) {
        const page = await this.post('rounds', after == null ? { limit: this.pageSize } : { after: String(after), limit: this.pageSize })
        const rounds = (page && page.rounds) || []
        const todo = rounds.filter(entry => {
          const old = index.rounds.get(entry.txid)
          return !(old && old.state == entry.state && DONE.has(entry.state) && old.batches.every(b => b.tree))
        })
        const work = async () => { for (let e; (e = todo.shift());) index.putRound(e, await this._trees(e)) }
        await Promise.all(Array.from({ length: this.concurrency }, work))
        if (!rounds.length || !page.next) break
        after = Number(page.next)
        this.cursor = Math.max(this.cursor || 0, after)
      }
      this.synced = true; this.lastSync = Date.now(); this.lastError = null
    } catch (e) { this.lastError = String(e && e.message || e); this.onError(e) }
  }
}

// --- reading transactions ------------------------------------------------------

// What each input of a transaction is to the Ark: { kind, path, place } or null. Only
// what the index and the witness say; nothing is fetched.
const inputRoles = (tx, index) => (tx.vin || []).map(vin => {
  if (!vin || vin.is_coinbase || !vin.prevout) return null
  const place = index.outpoints.get(`${vin.txid}:${vin.vout}`) || index.scripts.get(vin.prevout.scriptpubkey) || null
  const rev = revealedScript(vin.witness)
  const cls = rev ? classifyScript(rev.script) : null
  if (!place && !cls) return null
  return { place, path: cls ? cls.path : null, cls }
})

// The Ark's label for a transaction: { role, ... } or null. `opts.board(leafId)` answers
// the operator's board_status (a promise, null when it knows no such board);
// `opts.spenders(tx)` the transactions spending its outputs (for a board's funding).
const ROLE_WORDS = {
  round: 'Ark round',
  unroll: 'Ark unroll',
  exit: 'Ark exit',
  spend: 'Ark coin spent on the chain',
  board: 'Ark board',
  board_onchain: 'Ark board: coin taken onto the chain',
  reclaim: 'Ark reclaim',
  sweep: 'Ark sweep',
  offboard: 'Ark offboard',
}

const txRole = async (tx, index, opts = {}) => {
  if (!tx || !tx.txid) return null
  const round = index.rounds.get(tx.txid)
  if (round) return { role: 'round', words: ROLE_WORDS.round, round: round.number, round_txid: round.txid }
  const ins = inputRoles(tx, index)
  const outs = (tx.vout || []).map(o => index.scripts.get(o.scriptpubkey) || null)
  const first = (pred) => { const i = ins.findIndex(pred); return i < 0 ? null : { i, r: ins[i] } }
  const ref = place => place ? { round: place.number, round_txid: place.round, batch_vout: place.batch_vout, leaf_id: place.leaf_id || null } : {}

  // A leaf's output on the chain, spent.
  const leafIn = first(r => r && r.place && r.place.kind == 'leaf')
  if (leafIn) {
    const role = leafIn.r.path == 'collab' ? 'spend' : 'exit'
    return { role, words: ROLE_WORDS[role], input: leafIn.i, ...ref(leafIn.r.place) }
  }
  // A batch output or a node, spent by its unroll, its reclaim or its sweep.
  const treeIn = first(r => r && r.place && (r.place.kind == 'batch' || r.place.kind == 'node'))
  if (treeIn) {
    const p = treeIn.r.path
    const role = p == 'unroll' ? 'unroll' : p == 'reclaim' ? 'reclaim' : p == 'sweep' ? 'sweep' : null
    if (role) return { role, words: ROLE_WORDS[role], input: treeIn.i, level: treeIn.r.place.level, ...ref(treeIn.r.place) }
  }
  // An offboard: a round's own output (not a batch) unlocked with the operator's preimage
  // into the destination its owner named when leaving the Ark.
  const off = first((r, k) => r && r.path == 'hashlock' && index.rounds.has(tx.vin[k].txid))
  if (off) {
    const round = index.rounds.get(tx.vin[off.i].txid)
    if (!round.batches.some(b => b.vout == tx.vin[off.i].vout))
      return { role: 'offboard', words: ROLE_WORDS.offboard, input: off.i, round: round.number, round_txid: round.txid }
  }
  // An entry's unlock into its leaf: output 0 pays the leaf the script pins.
  const unlock = first(r => r && r.path == 'unlock')
  if (unlock) {
    const leaf = index.scripts.get('5120' + unlock.r.cls.leaf_program)
    if (leaf && leaf.kind == 'leaf') return { role: 'unroll', words: ROLE_WORDS.unroll, input: unlock.i, ...ref(leaf) }
  }
  // A sweep of an entry or a node the index does not hold (a batch it never read).
  const sweep = first(r => r && r.path == 'sweep')
  if (sweep && outs.every(o => !o)) return { role: 'sweep', words: ROLE_WORDS.sweep, input: sweep.i }
  // A board's conversion: the leaf id from the board output's program and the leaf's.
  const convert = first(r => r && r.path == 'convert')
  if (convert && opts.board) {
    const boardProgram = programOf(tx.vin[convert.i].prevout.scriptpubkey)
    if (boardProgram) {
      const id = boardLeafId(boardProgram, convert.r.cls.leaf_program)
      const b = await opts.board(id).catch(() => null)
      if (b && b.txid == tx.vin[convert.i].txid && b.vout == tx.vin[convert.i].vout)
        return { role: 'board_onchain', words: ROLE_WORDS.board_onchain, input: convert.i, leaf_id: id, board_txid: b.txid, board_vout: b.vout }
    }
  }
  // A board's funding: one of its outputs is spent by a conversion we can recognise.
  if (opts.spenders && opts.board) {
    const spenders = await opts.spenders(tx).catch(() => [])
    for (const { vout, spender } of spenders || []) {
      if (!spender) continue
      const r = await txRole(spender, index, { board: opts.board })
      if (r && r.role == 'board_onchain' && r.board_txid == tx.txid && r.board_vout == vout)
        return { role: 'board', words: ROLE_WORDS.board, vout, leaf_id: r.leaf_id, converted_by: spender.txid }
    }
  }
  return null
}

// --- plain words -----------------------------------------------------------------

const ROUND_STATE_WORDS = {
  built: 'being formed',
  broadcast: 'on the chain, not final yet',
  final: 'final',
  lost: 'lost: its transaction will not confirm, so its coins never came to be',
}
const roundStateWords = s => ROUND_STATE_WORDS[s] || s

// How a batch output stands on the chain, from the transaction spending it (or none).
const batchStateWords = (spender, index) => {
  if (!spender) return { state: 'held', words: 'held off the chain' }
  const ins = inputRoles(spender, index)
  const p = (ins.find(r => r && r.path) || {}).path
  if (p == 'unroll') return { state: 'unrolled', words: 'opened on the chain: coins in it are being taken onto the chain', txid: spender.txid }
  if (p == 'reclaim') return { state: 'reclaimed', words: 'returned to the operator once every coin in it had moved on', txid: spender.txid }
  if (p == 'sweep') return { state: 'swept', words: 'swept by the operator after it expired', txid: spender.txid }
  return { state: 'spent', words: 'spent on the chain', txid: spender.txid }
}

// How one coin stands, following its path down from its batch output. `outspend(txid,
// vout)` answers the explorer's /tx/:txid/outspend/:vout and `getTx(txid)` its /tx/:txid
// (promises). The steps it can see are public: what reached the chain and how it was
// spent. A payment made off the chain is not.
const coinState = async (place, round, { outspend, getTx }) => {
  if (!round) return { state: 'unknown', words: 'its round is not known here' }
  if (round.state == 'lost') return { state: 'lost', words: 'never came to be: its round was lost' }
  if (round.state == 'built') return { state: 'forming', words: 'its round is being formed' }
  const step = async (txid, vout) => {
    const s = await outspend(txid, vout)
    if (!s || !s.spent) return null
    return await getTx(s.txid)
  }
  const pathOf = tx => {
    const rev = (tx.vin || []).map(v => revealedScript(v.witness)).map(r => r ? classifyScript(r.script) : null)
    return (rev.find(c => c && c.path) || {}).path || null
  }
  let txid = round.txid, vout = place.batch_vout
  const path = place.path || []
  for (let level = 0; level <= path.length; level++) {
    const spender = await step(txid, vout)
    const what = level == 0 ? 'batch' : level == path.length ? 'entry' : 'node'
    if (!spender) {
      if (level == 0) return { state: 'held', words: 'held off the chain in its batch', note: 'payments made off the chain are not shown here' }
      if (what == 'entry') return { state: 'unrolling', words: 'on its way onto the chain: its entry is on the chain, waiting to be unlocked into the coin', txid }
      return { state: 'unrolling', words: 'on its way onto the chain: its batch is opened down to the level above it', txid }
    }
    const p = pathOf(spender)
    if (p == 'reclaim') return { state: 'moved_on', words: 'moved on off the chain: its owner gave it up for a newer coin, and the operator reclaimed its batch', txid: spender.txid }
    if (p == 'sweep') return { state: 'swept', words: 'swept by the operator with its expired batch', txid: spender.txid }
    if (what == 'entry') {
      if (p != 'unlock') return { state: 'spent', words: 'its entry was spent on the chain', txid: spender.txid }
      const after = await step(spender.txid, 0)
      if (!after) return { state: 'onchain', words: 'taken onto the chain: the coin is an output on the chain', txid: spender.txid, vout: 0 }
      const q = pathOf(after)
      if (q == 'exit') return { state: 'exited', words: 'exited by its owner: taken onto the chain and spent there', txid: after.txid }
      return { state: 'spent_onchain', words: 'taken onto the chain and spent there by its owner with the operator', txid: after.txid }
    }
    if (p != 'unroll') return { state: 'spent', words: 'its batch was spent on the chain', txid: spender.txid }
    txid = spender.txid; vout = path[level]
  }
  return { state: 'unknown', words: 'not readable' }
}

module.exports = {
  parseScript, revealedScript, classifyScript, leafId, boardLeafId, programOf, treePlaces,
  ArkIndex, ArkMirror, inputRoles, txRole, ROLE_WORDS, roundStateWords, batchStateWords, coinState,
}
