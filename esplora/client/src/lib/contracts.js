// Contract labels for a transaction, from the Sequentia registry's contract
// index (CONTRACT_MAP_URL, the registry's /contracts/index.minimal.json):
//
//   leaves:  { <commitment root>: [[template_hash, name, version, leaf, path], ...] }
//   scripts: { <scriptPubKey>:    [template_hash, name, version] }
//
// The registry lists a template there only once it has verified it: the
// descriptor, the sources, the golden vectors, and the commitment root the
// pinned compiler builds from the source. A Simplicity leaf's commitment root is
// one constant per template, because a template keeps its parameters in a data
// leaf, so a Simplicity spend is recognised by the root it reveals. A spend of
// any other leaf is recognised by its output script, when the registry holds
// that instance.
//
// No dependency on the rest of the client, so it can be tested on its own.

// The leaf a taproot script-path spend reveals: the script (for a Simplicity
// leaf, the 32-byte commitment root) and the control block, whose first byte is
// the leaf version with the output key's parity. An annex, if any, is last.
export const revealedLeaf = witness => {
  if (!witness || witness.length < 2) return null
  const end = witness.length >= 3 && witness[witness.length - 1].startsWith('50') ? witness.length - 1 : witness.length
  const control = witness[end - 1], script = witness[end - 2]
  if (!control || script == null || control.length < 66 || (control.length - 66) % 64 != 0) return null
  return { version: parseInt(control.slice(0, 2), 16) & 0xfe, script, control }
}

const LEAF_SIMPLICITY = 0xbe

const label = ([ template_hash, name, version, leaf, path ]) => ({ template_hash, name, version, leaf: leaf || null, path: path || null })

// For each input, the contract it spends and the way it spends it, or null.
export const contractInputs = (tx, map) => (tx.vin || []).map(vin => {
  if (!map || vin.is_coinbase || vin.is_pegin || !vin.prevout) return null
  const instance = map.scripts && map.scripts[vin.prevout.scriptpubkey]
  const leaf = revealedLeaf(vin.witness)
  if (leaf && leaf.version == LEAF_SIMPLICITY && leaf.script.length == 64) {
    const found = (map.leaves && map.leaves[leaf.script]) || []
    // One root can sit in several templates; the instance, when the registry
    // holds it, says which one this output is.
    const pick = instance ? found.find(f => f[0] == instance[0]) : found.length == 1 ? found[0] : null
    if (pick) return { ...label(pick), cmr: leaf.script }
    if (found.length > 1) return { candidates: found.map(label), cmr: leaf.script }
  }
  return instance ? label(instance) : null
})

// For each output, the input whose contract it continues (an output paying the
// very script that input spent: the contract's next state), else the contract
// the registry knows the output's script as, else null.
export const contractOutputs = (tx, map, inputs = contractInputs(tx, map)) => (tx.vout || []).map(out => {
  if (!map || !out.scriptpubkey) return null
  const i = (tx.vin || []).findIndex((vin, k) => inputs[k] && inputs[k].name && vin.prevout && vin.prevout.scriptpubkey == out.scriptpubkey)
  if (i >= 0) return { successor_of: i, ...inputs[i], leaf: null, path: null }
  const instance = map.scripts && map.scripts[out.scriptpubkey]
  return instance ? label(instance) : null
})

// What a label reads as.
export const contractName = c => c.candidates ? c.candidates.map(x => x.name).join(' or ') : `${c.name} v${c.version}`
