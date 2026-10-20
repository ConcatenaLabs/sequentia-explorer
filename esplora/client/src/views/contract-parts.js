import { formatTime, formatAssetAmount, formatNumber } from './util'

// The registry's record of a template, beside its contract index.
const contractBase = (process.env.CONTRACT_MAP_URL || '').replace(/\/index\.minimal\.json$/, '')
export const contractLink = (c, text) => contractBase && c.template_hash
  ? <a href={`${contractBase}/${c.template_hash}`} target="_blank" rel="external">{text}</a>
  : text

// SEQUENTIA: how the explorer shows a contract that sequentia-electrs decoded
// (GET /api/tx/:txid/contracts and /api/contracts/...): the template by its
// registry name, the path taken, the program's cost against its budget, the
// witness by the names the template's descriptor gives, and the terms and state
// read from the data leaf by name.

const reverseHex = h => h.match(/../g).reverse().join('')
const bigOf = h => BigInt('0x' + (h || '0'))

// A parameter or slot, shown by its role (docs/descriptor.md in
// sequentia-contracts): an asset by its ticker, a time as a date, a relative
// lock as the delay it sets, a key or hash as hex.
export const roleValue = (v, { assetMap, t }) => {
  const n = bigOf(v.hex)
  switch (v.role) {
    case 'asset': {
      // A program sees an asset id in internal byte order, the reverse of the
      // hex an RPC or this explorer prints.
      const id = reverseHex(v.hex), meta = assetMap && assetMap[id]
      return <span><a href={`asset/${id}`} className="mono">{meta && meta[1] ? `${meta[1]} ` : ''}{id}</a></span>
    }
    case 'amount': return <span>{formatNumber(n.toString())} <em className="text-gray">{t`atoms`}</em></span>
    case 'time': return n == BigInt(0) ? <span>0</span>
      : n < BigInt(500000000) ? <span>{t`block`} {n.toString()}</span>
      : <span>{formatTime(Number(n))} <em className="text-gray">({n.toString()})</em></span>
    case 'height': return <span>{t`block`} {n.toString()}</span>
    case 'sequence': {
      const x = Number(n), units = x & 0xffff
      return <span>{x & (1 << 22) ? t`${formatNumber(units * 512)} seconds` : t`${formatNumber(units)} blocks`} <em className="text-gray">(nSequence {x})</em></span>
    }
    case 'number': return <span>{formatNumber(n.toString())}</span>
    default: return <span className="mono">{v.hex}</span>
  }
}

const valueRows = (title, list, S) => list && list.length > 0 && [
  <div className="vin-body-row contract-section"><div>{title}</div><div></div></div>
, ...list.map(v =>
    <div className="vin-body-row contract-value">
      <div title={v.label}>{v.name}</div>
      <div>{roleValue(v, S)}{v.label && [ <br/>, <small className="text-gray">{v.label}</small> ]}</div>
    </div>)
]

export const templateName = tpl => tpl && `${tpl.name} v${tpl.version}`

export const contractHref = d => d && (d.cmr || d.leaf_id) && d.instance ? `contract/${d.cmr || d.leaf_id}/${d.instance}` : null
export const rootHref = d => d && (d.cmr || d.leaf_id) ? `contract/${d.cmr || d.leaf_id}` : null

// The line under an input's header: the path and the template, or the root of
// an unregistered program.
export const decodedBadge = (d, t) => {
  if (!d) return null
  if (d.template) {
    const path = d.path && d.path.name ? `${d.path.name} · ` : ''
    return <span className="contract-label">{path}{contractLink({ template_hash: d.template.hash }, templateName(d.template))}
      {contractHref(d) && [' ', <a href={contractHref(d)} className="contract-page-link">{t`contract`} &rarr;</a>]}</span>
  }
  if (d.kind == 'simplicity') return <span className="contract-label">{t`unregistered Simplicity program`} <a href={rootHref(d)} className="mono">{d.cmr.slice(0, 16)}…</a></span>
  return null
}

export const costLine = (d, t) => d.cost && d.budget && <span>
  {t`${formatNumber(d.cost.wu)} WU of a ${formatNumber(d.budget.wu)} WU budget`}
  {d.annex ? t` (${formatNumber(d.budget.wu_without_annex)} WU without the ${d.annex.bytes}-byte annex padding)` : ''}
  {d.max_cost_wu ? t`; the template's bound is ${formatNumber(d.max_cost_wu)} WU` : ''}
  {d.within_budget === false ? <strong> {t`over budget`}</strong> : ''}
</span>

const witnessRows = (d, S) => {
  const { t } = S
  if (d.witness) return [
    <div className="vin-body-row contract-section"><div>{t`Witness`}</div><div><em className="text-gray">{t`by the names the template gives`}</em></div></div>
  , ...d.witness.map(w =>
      <div className="vin-body-row contract-value">
        <div>{w.name} <em className="text-gray">{w.type}</em></div>
        <div className="mono">{w.pruned ? <em className="text-gray">{t`not on this path`}</em>
          : w.selects_path ? `${w.value} → ${d.path.name}`
          : (w.hex || w.value)}</div>
      </div>)
  ]
  if (d.witness_values) return [
    <div className="vin-body-row contract-section"><div>{t`Witness values`}</div><div><em className="text-gray">{t`in the order the program reads them; no registered template names them`}</em></div></div>
  , ...d.witness_values.map(w =>
      <div className="vin-body-row contract-value"><div className="mono">{w.type}</div><div className="mono">{w.hex || w.value}</div></div>)
  ]
  return null
}

// The rows a decoded contract input adds to the input's details.
export const decodedInputRows = (d, S) => {
  const { t } = S
  if (!d) return null
  return [
    <div className="vin-body-row">
      <div>{t`Contract`}</div>
      <div>{d.template
        ? [ contractLink({ template_hash: d.template.hash }, templateName(d.template)), ' ', <span className="mono">{d.template.hash}</span>
          , d.template.summary && [ <br/>, <em className="text-gray">{d.template.summary}</em> ] ]
        : d.kind == 'simplicity' ? [ t`Unregistered: no verified template has this commitment root.`, ' ', <a href={rootHref(d)}>{t`Every spend of it`}</a> ]
        : d.kind == 'tapscript' ? t`A tapscript leaf no registered template has`
        : t`A script-path spend`}</div>
    </div>
  , d.path && <div className="vin-body-row">
      <div>{t`Spending path`}</div>
      <div>{d.path.name
        ? [ <strong>{d.path.name}</strong>, d.path.who ? t` by ${d.path.who}` : '', d.path.effect ? [ <br/>, <em className="text-gray">{d.path.effect}</em> ] : '' ]
        : t`one of ${(d.path.candidates || []).map(p => p.name).join(', ')}`}</div>
    </div>
  , d.cmr && <div className="vin-body-row">
      <div>{t`Commitment root`}</div>
      <div className="mono"><a href={rootHref(d)}>{d.cmr}</a></div>
    </div>
  , d.cost && <div className="vin-body-row">
      <div>{t`Cost`}</div>
      <div>{costLine(d, t)}</div>
    </div>
  , d.program_bytes != null && <div className="vin-body-row">
      <div>{t`Program`}</div>
      <div>{t`${formatNumber(d.program_bytes)} bytes, witness ${formatNumber(d.witness_bytes)} bytes, witness stack ${formatNumber(d.witness_stack_bytes)} bytes`}</div>
    </div>
  , d.decode_error && <div className="vin-body-row"><div>{t`Decoding`}</div><div className="text-danger">{d.decode_error}</div></div>
  , ...(witnessRows(d, S) || [])
  , ...(valueRows(t`Terms`, d.terms, S) || [])
  , ...(valueRows(t`State`, d.state, S) || [])
  , d.data_leaf && <div className="vin-body-row">
      <div>{t`Data leaf`}</div>
      <div>{t`${d.data_leaf.name}: these terms and this state hash to the leaf beside the program`} <span className="mono">{d.data_leaf.hash}</span></div>
    </div>
  , d.template && d.kind == 'simplicity' && <div className="vin-body-row">
      <div>{t`Recomputed`}</div>
      <div>{d.recomputed ? t`The template with these values gives the very script this input spends.`
                         : t`Not every term is revealed by this spend, so the script was not recomputed.`}</div>
    </div>
  , d.kind == 'tapscript' && d.stack && <div className="vin-body-row">
      <div>{t`Stack`}</div>
      <div className="mono">{d.stack.map(s => [ ' ', s.length ? s : <em>&lt;empty&gt;</em> ])}</div>
    </div>
  , contractHref(d) && <div className="vin-body-row">
      <div>{t`This contract`}</div>
      <div><a href={contractHref(d)}>{t`Its page: every spend, its state after each`} &rarr;</a></div>
    </div>
  ]
}

// The line under an output that carries an input's contract on.
export const decodedOutputBadge = (o, t, S) => o && <span className="contract-label">
  {t`Next state of input #${o.successor_of}`} · {o.template ? templateName(o.template) : ''}
  {o.state && o.state.length ? [ ': ', ...o.state.map((v, i) => [ i ? ', ' : '', `${v.name} `, roleValue(v, { t, ...S }) ]) ] : ''}
</span>

export const stateList = (list, S) => list && list.length > 0
  ? list.map((v, i) => [ i ? <br/> : '', <span>{v.name} {roleValue(v, S)}</span> ])
  : null
