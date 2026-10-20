import layout from './layout'
import { formatTime, formatAssetAmount } from './util'
import { contractLink, templateName, roleValue, stateList, costLine, rootHref } from './contract-parts'

// SEQUENTIA: a page per contract instance, from sequentia-electrs'
// GET /contracts/:root/instance/:params: the template, its terms, the coins it
// holds now with their state, and every spend in order. An instance is its
// template's commitment root and its parameters; each spend of a contract that
// keeps state re-creates it at a new address, and the chain of those coins is
// followed from one spend to the next.


const when = (status, t) => status && status.confirmed
  ? <span><a href={`block/${status.block_hash}`}>#{status.block_height}</a> · {formatTime(status.block_time)}</span>
  : <em>{t`unconfirmed`}</em>

const outputCell = (o, S) => o && <span>
  {o.value != null
    ? [ formatAssetAmount(o.value, S.assetMap && o.asset && S.assetMap[o.asset] ? S.assetMap[o.asset][3] : 0, S.t), ' '
      , o.asset ? <a href={`asset/${o.asset}`}>{S.assetMap && S.assetMap[o.asset] && S.assetMap[o.asset][1] || o.asset.slice(0, 12) + '…'}</a> : '' ]
    : <em>{S.t`confidential`}</em>}
</span>

const spendRow = (e, S) => {
  const { t } = S, i = e.input
  return <div className="contract-spend">
    <div className="contract-spend-head">
      <strong>{i.path && i.path.name || t`spend`}</strong>
      {' · '}<a href={`tx/${e.txid}?input:${e.vin}&expand`} className="mono">{e.txid.slice(0, 16)}…:{e.vin}</a>
      {' · '}{when(e.status, t)}
    </div>
    <div className="contract-spend-body">
      <div className="contract-kv"><div>{t`Spent`}</div><div><a href={`tx/${e.prevout.txid}?output:${e.prevout.vout}`} className="mono">{e.prevout.txid.slice(0, 16)}…:{e.prevout.vout}</a></div></div>
      { i.state && i.state.length > 0 && <div className="contract-kv"><div>{t`State before`}</div><div>{stateList(i.state, S)}</div></div> }
      { i.cost && <div className="contract-kv"><div>{t`Cost`}</div><div>{costLine(i, t)}</div></div> }
      { i.witness && <div className="contract-kv"><div>{t`Witness`}</div><div className="contract-witness">
          {i.witness.filter(w => !w.pruned && !/^param:|^slot:/.test(w.source)).map(w =>
            <div><span>{w.name}</span> <span className="mono">{w.selects_path ? `${w.value} → ${i.path.name}` : (w.value || w.hex)}</span></div>)}
        </div></div> }
      { e.owned_outputs && e.owned_outputs.length > 0 && <div className="contract-kv"><div>{t`Outputs 2k, 2k+1`}</div><div>
          {e.owned_outputs.map(o => <div><a href={`tx/${e.txid}?output:${o.vout}`}>#{o.vout}</a> {outputCell(o, S)}</div>)}
        </div></div> }
      { e.successors.length > 0
        ? e.successors.map(s => <div className="contract-kv"><div>{t`Next state`}</div><div>
            <a href={`tx/${e.txid}?output:${s.vout}`}>{t`output`} #{s.vout}</a> {outputCell(s.output, S)}
            {s.state && s.state.length > 0 && [ <br/>, stateList(s.state, S) ]}
            <br/>{s.spent_by ? <a href={`tx/${s.spent_by.txid}?input:${s.spent_by.vin}`}>{t`spent by`} {s.spent_by.txid.slice(0, 16)}… &rarr;</a> : <em>{t`unspent`}</em>}
          </div></div>)
        : <div className="contract-kv"><div>{t`Next state`}</div><div><em>{t`none: this spend did not re-create the contract`}</em></div></div> }
    </div>
  </div>
}

export const contract = ({ t, contract: c, ...S }) => {
  if (!c) return;
  const tpl = c.template, opt = { t, ...S }
  return layout(
    <div className="container contract-page">
      <h1 className="font-h2">{tpl ? templateName(tpl) : t`Contract`}</h1>
      { tpl && tpl.summary && <p className="text-gray">{tpl.summary}</p> }
      <div className="contract-terms">
        <div><div>{t`Template`}</div><div>{tpl ? [ contractLink({ template_hash: tpl.hash }, tpl.hash) ] : '—'}</div></div>
        <div><div>{t`Commitment root`}</div><div className="mono"><a href={rootHref(c)}>{c.leaf_id}</a></div></div>
        { (c.terms || []).map(v => <div><div title={v.label}>{v.name}</div><div>{roleValue(v, opt)}{v.label && [ <br/>, <small className="text-gray">{v.label}</small> ]}</div></div>) }
      </div>

      <h2 className="font-h3">{t`Now`}</h2>
      { c.current && c.current.length
        ? c.current.map(x => <div className="contract-current">
            <a href={`tx/${x.txid}?output:${x.vout}`} className="mono">{x.txid.slice(0, 16)}…:{x.vout}</a> {outputCell(x.output, opt)}
            {x.state && x.state.length > 0 && [ <br/>, stateList(x.state, opt) ]}
          </div>)
        : <p><em>{t`No unspent coin of this contract is known: its last spend did not re-create it, or the coin that holds it now has not been spent since it was made, and only a spend reveals a contract's terms.`}</em></p> }

      <h2 className="font-h3">{t`Spends`}</h2>
      { c.chains.map((chain, n) => <div className="contract-chain">
          <h3 className="font-p1">{t`Coin ${n + 1}`}{chain.length ? [ ' · ', t`made by`, ' ', <a href={`tx/${chain[0].prevout.txid}?output:${chain[0].prevout.vout}`} className="mono">{chain[0].prevout.txid.slice(0, 16)}…</a> ] : ''}</h3>
          { chain.map(e => spendRow(e, opt)) }
        </div>) }
    </div>
  , { t, ...S })
}

export const contractRoot = ({ t, contractRoot: r, ...S }) => {
  if (!r) return;
  const instances = {}
  r.spends.forEach(s => { const k = s.instance || ''; (instances[k] = instances[k] || []).push(s) })
  return layout(
    <div className="container contract-page">
      <h1 className="font-h2">{t`Commitment root`}</h1>
      <p className="mono">{r.leaf_id}</p>
      <p>{r.templates.length
        ? [ t`The program of`, ' ', r.templates.map((x, i) => [ i ? ', ' : '', contractLink({ template_hash: x.hash }, templateName(x)), ` (${x.leaf})` ]) ]
        : t`No verified template in the registry has this root, so its spends are shown unnamed.`}</p>
      <h2 className="font-h3">{t`Spends`} ({r.spends.length}{r.spends.length >= r.limit ? '+' : ''})</h2>
      { Object.keys(instances).map(k => <div className="contract-chain">
          { k && <h3 className="font-p1"><a href={`contract/${r.leaf_id}/${k}`}>{t`Instance`} {k.slice(0, 16)}… &rarr;</a></h3> }
          { instances[k].map(s => <div className="contract-spend-head">
              {s.path || t`spend`} · <a href={`tx/${s.txid}?input:${s.vin}&expand`} className="mono">{s.txid.slice(0, 16)}…:{s.vin}</a> · {when(s.status, t)}
              {s.state && s.state.length > 0 && [ ' · ', s.state.map((v, i) => [ i ? ', ' : '', `${v.name} `, roleValue(v, { t, ...S }) ]) ]}
            </div>) }
        </div>) }
    </div>
  , { t, ...S })
}
