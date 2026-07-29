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

module.exports = { intersectAtMinimum }
