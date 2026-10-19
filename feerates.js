// Pure fee-rate reduction, in its own module so it can be unit-tested without
// starting the server.

// THE INTERSECTION, AT THE MINIMUM RATE — the whole point of this endpoint.
//
// Minimum is the only rule that makes "offered in the wallet's picker" imply
// "will relay at every node we send to". The wallet sizes a fee as
// ceil(relay_floor * 1e8 / published_rate), so a published rate at or below every
// node's own rate makes the atoms it derives clear the floor everywhere.
// Publishing anything higher — a maximum, an average, or one node's view —
// under-sizes the fee for whichever node prices the asset lower, and that node
// refuses the transaction with a generic "min relay fee not met" the user cannot
// act on. Membership alone was never sufficient: the node computes
// fee_atoms * its_own_rate / 1e8 >= minRelayTxFee, so the RATE has to be safe too.
//
// An asset missing from ANY node is dropped: offering an asset one broadcast
// target will not accept is the same defect in a different place.
//
// `results` is [{ rates: Map<hex, rate>, label: Map<hex, displayKey> }]. Keys are
// already normalised to hex by nodeRatesByHex, because labels are per-node and
// intersecting raw label keys would silently yield nothing.
function intersectAtMinimum(results) {
  if (!results.length) return {}
  const [first, ...rest] = results
  const out = {}
  for (const [hex, rate] of first.rates) {
    let min = rate
    let missing = false
    for (const other of rest) {
      const r = other.rates.get(hex)
      if (r === undefined) { missing = true; break }
      if (r < min) min = r
    }
    if (missing) continue
    out[first.label.get(hex) || hex] = min
  }
  return out
}

// What each node we broadcast to says about every fee asset, merged per asset: how many of them
// accept a fee in it (listed and priced above zero), out of how many were asked. That is the
// wallet's three-way light: accepted by all, by some, by none. Metadata (label, precision, the
// registry flag, the market price) comes from the first node that reports the asset.
//
// `results` is one getfeeassetinfo answer per node, each keyed by asset hex. An asset a node does
// not report counts as not accepted there.
function combineFeeInfo(results) {
  const nodes = results.length
  const out = {}
  for (const res of results) {
    for (const [key, info] of Object.entries(res || {})) {
      const hex = String((info && info.asset) || key).toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(hex)) continue
      const cur = out[hex] || (out[hex] = {
        asset: hex,
        label: info.label || hex,
        precision: Number.isFinite(Number(info.precision)) ? Number(info.precision) : 8,
        registry_listed: !!info.registry_listed,
        market_price: Number.isFinite(Number(info.market_price)) && Number(info.market_price) > 0 ? Number(info.market_price) : null,
        accepted_by: 0,
        nodes,
      })
      if (info.accepted === true) cur.accepted_by += 1
      if (cur.market_price == null && Number(info.market_price) > 0) cur.market_price = Number(info.market_price)
    }
  }
  return out
}

module.exports = { intersectAtMinimum, combineFeeInfo }
