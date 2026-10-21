// Whether Bitcoin testnet4 is split into competing chains near its tip, from bitcoind's
// getchaintips. In its own module so it can be unit-tested without starting the server.
//
// Sequentia does not anchor a parent block another chain contests: its producers back the anchor
// down to the last uncontested height. On 21/10/2026 testnet4 ran two equal 35-block branches from
// 157183, the anchor stayed at 157182 for hours, and every swap with an on-chain BTC leg waited on
// it while the wallet said "Could not reach the maker". This is what lets the wallet say why.
//
// A branch competes when it is not the active chain, is not invalid, and reaches within `near`
// blocks of the active tip. Returns { tip, contested_from, branches: [{ height, forked_at, status }] },
// contested_from being the first height where testnet4 has more than one chain (null when none).
const LIVE = new Set(['valid-headers', 'valid-fork', 'headers-only'])

function competingBranches(tips, { near = 6 } = {}) {
  const active = (tips || []).find(t => t && t.status === 'active')
  if (!active) return { tip: null, contested_from: null, branches: [] }
  const branches = (tips || [])
    .filter(t => t && LIVE.has(t.status) && Number(t.branchlen) > 0 && Number(t.height) >= active.height - near)
    .map(t => ({ height: Number(t.height), forked_at: Number(t.height) - Number(t.branchlen) + 1, status: t.status }))
    .sort((a, b) => a.forked_at - b.forked_at)
  return { tip: active.height, contested_from: branches.length ? branches[0].forked_at : null, branches }
}

module.exports = { competingBranches }
