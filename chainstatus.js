// Pure chain-health verdict for GET /chainstatus, in its own module so it can be
// unit-tested without a node.
//
// The status page and its checker read one answer to two questions:
//
// - Is the chain making blocks? The tip's age against the block interval. A
//   block every minute is the target, so a tip older than `blockLateSeconds`
//   is late and one older than `blockStalledSeconds` means the chain has
//   stalled. `ok` is true only while blocks arrive on time.
// - Is the Bitcoin anchor current? The tip's anchor must be a block the node's
//   own Bitcoin watcher has checked (`anchorstatus` "ok") and lie within
//   `anchorMaxBehind` blocks of the Bitcoin tip the testnet4 indexer reports.
//   An anchor the node cannot check, or one that has fallen behind, is not
//   current, whatever the height says. While Bitcoin runs competing chains
//   above some height (`forks`, from parent-forks.js), the node anchors at the
//   last height they share and the anchor is `waiting`: the anchoring rule at
//   work, not a fault, so `ok` stays true and the answer says from where
//   Bitcoin is contested. New blocks become final once Bitcoin settles.
//
// Inputs: `info` is getblockchaininfo, `anchor` is getanchorstatus, `btcHeight`
// is the testnet4 tip height (null when the indexer did not answer), `forks` is
// competingBranches() of testnet4's chain tips (null when unknown), `now` is
// unix seconds.
const DEFAULT_LIMITS = { blockLateSeconds: 300, blockStalledSeconds: 900, anchorMaxBehind: 6 }

function chainVerdict({ info, anchor, btcHeight, forks = null, now, limits = DEFAULT_LIMITS }) {
  const age = Math.max(0, now - Number(info.time))
  const blockState = age <= limits.blockLateSeconds ? 'on_time'
    : age <= limits.blockStalledSeconds ? 'late' : 'stalled'

  const known = Number.isInteger(btcHeight)
  const behind = known ? Math.max(0, btcHeight - Number(anchor.anchorheight)) : null
  let anchorState
  if (anchor.anchorstatus !== 'ok') anchorState = 'unchecked'
  else if (!known) anchorState = 'bitcoin_unknown'
  else if (behind > 0 && forks && forks.contested_from != null && Number(anchor.anchorheight) >= forks.contested_from - 1) anchorState = 'waiting'
  else anchorState = behind <= limits.anchorMaxBehind ? 'current' : 'behind'

  return {
    height: Number(info.blocks),
    tip: info.bestblockhash,
    tip_time: Number(info.time),
    blocks: { ok: blockState === 'on_time', state: blockState, age_seconds: age },
    anchor: {
      ok: anchorState === 'current' || anchorState === 'waiting',
      state: anchorState,
      height: Number(anchor.anchorheight),
      bitcoin_height: known ? btcHeight : null,
      behind,
      check: anchor.anchorstatus,
      ...(anchorState === 'waiting' ? { contested_from: forks.contested_from } : {}),
    },
    checked_at: now,
  }
}

module.exports = { chainVerdict, DEFAULT_LIMITS }
