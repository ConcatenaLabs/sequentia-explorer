// Pure fee-market reduction behind GET /feeinfo, in its own module so it can be
// unit-tested without starting the server (same split as feerates.js).
//
// A wallet needs two things to offer a fee choice: what the queue costs right
// now, and a small set of levels to pick from. The node answers the first with
// getmempoolcongestion. The levels are defined HERE, once, rather than in each
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

// THE LEVELS. All of them are derived from the next-block price N, the relay
// floor F and the replacement increment I:
//
//   low      ceil(F × 1.1)       the cheapest fee that still relays. It waits
//                                whenever blocks are full. The 10% covers fee-asset
//                                rates moving between sizing and relay (the price
//                                server re-quotes them every block), which would
//                                otherwise drop an exact-floor fee under the floor.
//   medium   ceil(N × 1.25) + I  the next block as things stand, with a margin.
//                                Exactly N loses: the cut moves while the block is
//                                still being filled, and the Qt bump that aimed at
//                                N with no margin never got in.
//   high     2N + 2I
//   highest  4N + 4I            room above every producer's private reserve price,
//                                which no node can observe.
//
// I also spaces the levels: with N ≥ F > 0 and I ≥ 1 they are strictly
// increasing, so it is taken as at least 1 even on a node configured with
// -incrementalrelayfee=0, where two levels could otherwise tie on a tiny floor.
function feeTiers(F, N, I) {
  const step = Math.max(I, 1)
  return {
    low: Math.ceil(F * 1.1),
    medium: Math.ceil(N * 1.25) + step,
    high: 2 * N + 2 * step,
    highest: 4 * N + 4 * step,
  }
}

function feeInfo(nodes) {
  const r = reduceCongestion(nodes)
  if (!r) return null
  return {
    unit: 'reference fee atoms per 1000 vbytes',
    floor: r.floor,
    next_block: r.nextBlock,
    next_block_full: r.full,
    replacement_increment: r.increment,
    backlog_blocks: r.backlog,
    mempool_txs: r.txs,
    mempool_vbytes: r.vbytes,
    tiers: feeTiers(r.floor, r.nextBlock, r.increment),
  }
}

module.exports = { feeInfo, feeTiers, reduceCongestion }
