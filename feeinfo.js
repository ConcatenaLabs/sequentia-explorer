// Pure fee-market reduction behind GET /feeinfo, in its own module so it can be
// unit-tested without starting the server (same split as feerates.js).
//
// A wallet needs two things to offer a fee choice: what the queue costs right
// now, and a small set of levels to pick from. The node answers the first twice:
// getmempoolcongestion reads the queue as it is, estimatesmartfee reads the
// history of how long fees took to confirm. The levels are defined HERE, once, rather than in each
// wallet: Ambra is a phone app, and a rule that lives in the app can only change
// with a release, while every wallet reading the same levels from one place
// keeps them consistent with each other.
//
// Every figure is in REFERENCE fee atoms per 1000 vbytes — the unit the node
// values every asset's fee into, which is what makes fees in different assets
// comparable at all. The wallet converts a level into its fee asset with that
// asset's /feerates rate, exactly as it already sizes a fee today.

// THE MAXIMUM ACROSS NODES — the mirror of /feerates' minimum.
//
// /feerates publishes the LOWEST rate any broadcast target applies, because a
// lower rate makes the wallet size MORE atoms. Here the figures are floors and
// cut-offs, so the safe side is the HIGHEST: a fee that clears the strictest
// node clears all of them, and POST /api/tx submits to every one of them.
//
// `nodes` is the parsed getmempoolcongestion output of each broadcast target.
// Amounts arrive as coin decimals (0.00000100) or as atoms; both are read as atoms.
function toAtoms(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e8) : null
}

function reduceCongestion(nodes) {
  if (!nodes.length) return null
  let floor = 0, nextBlock = 0, increment = 0, backlog = 0, txs = 0, vbytes = 0
  let full = false
  for (const c of nodes) {
    if (!c) return null
    const relay = toAtoms(c.minrelaytxfee)
    const mempool = toAtoms(c.mempoolminfee)
    const inc = toAtoms(c.incrementalrelayfee)
    const next = Number(c.next_block_min_atoms_per_kvb)
    // A node whose answer lacks a floor cannot be stood behind; refuse rather
    // than publish a cut-off that might be under its real one.
    if (relay === null || mempool === null || inc === null || !Number.isFinite(next)) return null
    floor = Math.max(floor, relay, mempool)
    nextBlock = Math.max(nextBlock, next)
    increment = Math.max(increment, inc)
    backlog = Math.max(backlog, Number(c.backlog_blocks) || 0)
    txs = Math.max(txs, Number(c.size) || 0)
    vbytes = Math.max(vbytes, Number(c.bytes) || 0)
    full = full || c.next_block_full === true
  }
  // next_block_min is already the relay floor when the block is not full, but
  // take the maximum explicitly: one node's empty block says nothing about
  // another node's floor.
  nextBlock = Math.max(nextBlock, floor)
  return { floor, nextBlock, increment, backlog, txs, vbytes, full }
}

// estimatesmartfee targets, in blocks. 1 is not asked: the estimator clamps it
// to 2, and the next block is what getmempoolcongestion already answers, from
// the queue as it is rather than from history.
const ESTIMATE_TARGETS = [2, 3, 6, 12]

// The history-based half: for each target, the HIGHEST estimate any node gives
// (same reasoning as above), or null when no node has seen enough blocks to say.
// `estimates` is, per node, { target: parsed estimatesmartfee output or null }.
// "Insufficient data" is an answer, not a failure — the testnet is often too
// quiet for one — so a missing estimate only leaves that target null.
function reduceEstimates(perNode) {
  const out = {}
  for (const k of ESTIMATE_TARGETS) {
    let best = null
    for (const est of perNode) {
      const e = est && est[k]
      const atoms = e && e.feerate !== undefined ? toAtoms(e.feerate) : null
      if (atoms !== null && atoms > 0) best = best === null ? atoms : Math.max(best, atoms)
    }
    out[k] = best
  }
  return out
}

// THE LEVELS. Derived from the next-block price N, the relay floor F, the
// replacement increment I, and the estimates E(k) when there are any:
//
//   low      ceil(F × 1.1), ≥ E(12)     the economical choice: what history says
//                                       confirms within about twelve blocks. With no
//                                       history it is the cheapest fee that still
//                                       relays, and promises nothing while blocks are
//                                       full. The 10% covers fee-asset rates moving
//                                       between sizing and relay (the price server
//                                       re-quotes them every block), which would
//                                       otherwise drop an exact-floor fee under the
//                                       floor. On a congested regtest a floor-priced
//                                       low never confirmed in 30 blocks: honest, and
//                                       useless as a level, hence E(12).
//   medium   ceil(N × 1.25) + I, ≥ E(3) the next block as things stand, with a margin.
//                                       Exactly N loses: the cut moves while the block
//                                       is still being filled, and a bump that aimed
//                                       at N with no margin never got in.
//   high     2N + 2I,          ≥ E(2)
//   highest  4N + 4I,   ≥ ceil(1.5 E(2)) room above every producer's private reserve
//                                       price, which no node can observe.
//
// The queue is the primary signal because it is what the next producer will
// actually rank; the estimates are a floor under it, because the queue is a
// snapshot and a burst arriving after it is exactly what history has seen.
//
// I also spaces the levels, taken as at least 1 even on a node configured with
// -incrementalrelayfee=0; and each level is lifted to one atom above the one
// below, so they are strictly increasing whatever the estimates say.
function feeTiers(F, N, I, E = {}) {
  const step = Math.max(I, 1)
  const atLeast = (v, e) => (e ? Math.max(v, e) : v)
  // Integer ratios, not 1.1 and 1.25: 100 * 1.1 is 110.00000000000001 in
  // floating point and would ceil to 111.
  const low = atLeast(Math.ceil((F * 11) / 10), E[12])
  let medium = atLeast(Math.ceil((N * 5) / 4) + step, E[3])
  let high = atLeast(2 * N + 2 * step, E[2])
  let highest = atLeast(4 * N + 4 * step, E[2] ? Math.ceil((E[2] * 3) / 2) : 0)
  medium = Math.max(medium, low + 1)
  high = Math.max(high, medium + 1)
  highest = Math.max(highest, high + 1)
  return { low, medium, high, highest }
}

// How many blocks a fee rate R should take, or null when nothing supports a
// number. Measured on a congested regtest, both of the obvious answers broke
// their promise:
//
//   - "above the cut, so the next block": 233 against a cut of 221 took two
//     blocks, because what arrives after the snapshot outbids it. The next block
//     is promised only with the same 25% margin medium is priced with.
//   - "the smallest target whose estimate R meets": the estimator often answers
//     one flat figure for every target (270 for 2, 3, 6 and 12 blocks), so a fee
//     priced for twelve blocks was promised two and took four.
//
// So below the margin a level promises the target it was priced from
// (`nominal`), never less than the smallest target history supports. With no
// history that applies, it promises nothing.
function etaBlocks(R, N, full, E, nominal = ESTIMATE_TARGETS[0]) {
  if (!full || R >= Math.ceil((N * 5) / 4)) return 1
  for (const k of ESTIMATE_TARGETS) if (E[k] && R >= E[k]) return Math.max(k, nominal)
  return null
}

// The target each level is priced from when it is not priced from the queue.
const NOMINAL = { low: 12, medium: 3, high: 2, highest: 2 }

// `nodes` is, per broadcast target, { congestion, estimates } — the parsed
// getmempoolcongestion output and { target: estimatesmartfee output or null }.
function feeInfo(nodes) {
  if (!nodes.length) return null
  const r = reduceCongestion(nodes.map(n => n && n.congestion))
  if (!r) return null
  const E = reduceEstimates(nodes.map(n => n && n.estimates))
  const rates = feeTiers(r.floor, r.nextBlock, r.increment, E)
  const tiers = {}
  for (const [name, feerate] of Object.entries(rates))
    tiers[name] = { feerate, blocks: etaBlocks(feerate, r.nextBlock, r.full, E, NOMINAL[name]) }
  return {
    unit: 'reference fee atoms per 1000 vbytes',
    floor: r.floor,
    next_block: r.nextBlock,
    next_block_full: r.full,
    replacement_increment: r.increment,
    backlog_blocks: r.backlog,
    mempool_txs: r.txs,
    mempool_vbytes: r.vbytes,
    estimates: E,
    tiers,
  }
}

module.exports = { feeInfo, feeTiers, etaBlocks, reduceCongestion, reduceEstimates, ESTIMATE_TARGETS }
