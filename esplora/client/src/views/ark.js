import layout from './layout'
import { formatAssetValue, formatTime, formatNumber } from './util'

// SEQUENTIA: the Ark section. Coins held off the chain sit in batches, each batch one
// output of a round's transaction; the explorer server mirrors the rounds and batch trees
// the operator publishes (ark-index.js) and reads what the chain shows of each. One search
// box takes a round's txid, a round's number or a coin's id.

const short = h => h ? `${h.slice(0, 16)}…` : ''

const searchBox = (t, q) =>
  <form className="ark-search">
    <input className="ark-search-input" type="search" name="q" value={q || ''} autocomplete="off" spellcheck="false"
      placeholder={t`A round's txid or number, or a coin's id`} />
    <button type="submit" className="ark-search-btn">{t`Find`}</button>
  </form>

const kv = (k, v) => v != null && v !== '' && <div><div>{k}</div><div>{v}</div></div>

const roundView = (r, { t, assetMap }) => [
  <h2 className="font-h3">{t`Ark round #${r.number}`}</h2>
, <div className="stats-table font-p2 ark-table">
    {kv(t`Transaction`, <a href={`tx/${r.txid}`} className="mono">{r.txid}</a>)}
    {kv(t`State`, r.words)}
    {kv(t`Coins`, r.batches.length == 1 ? t`${formatNumber(r.coins)} in one batch` : t`${formatNumber(r.coins)} in ${r.batches.length} batches`)}
    {kv(t`Total`, Object.keys(r.totals).map((a, i) => [ i ? ', ' : '', formatAssetValue(a, r.totals[a], assetMap) ]))}
  </div>
, <h3 className="font-p1">{t`Batches`}</h3>
, <div className="ark-batches">
    { r.batches.map(b => <div className="ark-batch">
        <div><a href={`tx/${r.txid}?output:${b.vout}`}>{t`Output #${b.vout}`}</a>{' · '}
          {b.read ? [ formatAssetValue(b.asset, b.value, assetMap), ' · ', b.coins == 1 ? t`1 coin` : t`${formatNumber(b.coins)} coins` ] : <em>{t`not read yet`}</em>}</div>
        <div className="text-gray">{b.words}{b.txid ? [ ' · ', <a href={`tx/${b.txid}`}>{t`by this transaction`} &rarr;</a> ] : ''}</div>
      </div>) }
  </div>
]

const coinView = (c, { t, assetMap }) => [
  <h2 className="font-h3">{t`Ark coin`}</h2>
, <div className="stats-table font-p2 ark-table">
    {kv(t`Coin id`, <span className="mono">{c.leaf_id}</span>)}
    {kv(t`Kind`, c.what)}
    {kv(t`Value`, formatAssetValue(c.asset, c.value, assetMap))}
    {kv(t`State`, [ c.words, c.txid ? [ ' · ', <a href={`tx/${c.txid}`}>{t`the transaction`} &rarr;</a> ] : '' ])}
    {kv(t`Round`, [ <a href={`ark/${c.round}`}>#{c.round}</a>, ' · ', c.round_words ])}
    {kv(t`Batch`, <a href={`tx/${c.round_txid}?output:${c.batch_vout}`}>{t`output #${c.batch_vout} of the round's transaction`}</a>)}
    {kv(t`Place`, c.coins_in_batch
      ? (c.levels == 1 ? t`coin ${c.place} of ${c.coins_in_batch} in its batch, one level below the batch output`
                       : t`coin ${c.place} of ${c.coins_in_batch} in its batch, ${c.levels} levels below the batch output`)
      : t`coin ${c.place} in its batch`)}
  </div>
, c.note && <p className="text-gray"><em>{t`Payments made off the chain are not shown here: only what reached the chain.`}</em></p>
]

const boardView = (b, { t }) => [
  <h2 className="font-h3">{t`Ark board`}</h2>
, <p className="text-gray">{t`A board brings its owner's coins into the Ark with a transaction of their own.`}</p>
, <div className="stats-table font-p2 ark-table">
    {kv(t`Coin id`, <span className="mono">{b.leaf_id}</span>)}
    {kv(t`Transaction`, <a href={`tx/${b.txid}?output:${b.vout}`} className="mono">{short(b.txid)}:{b.vout}</a>)}
    {kv(t`State`, b.words)}
    {kv(t`Final`, b.finality == 'final' ? t`yes` : b.finality == 'not_in_chain' ? t`not in a block yet` : t`not yet`)}
    {b.exit_deadline && kv(t`Refresh by`, formatTime(b.exit_deadline))}
    {b.expiry && kv(t`Expires`, formatTime(b.expiry))}
  </div>
]

const latest = (rounds, { t }) => !rounds ? <p className="text-gray">{t`Loading…`}</p>
  : rounds.error ? <p className="text-gray">{t`The Ark's rounds cannot be read now.`}</p>
  : !rounds.rounds.length ? <p className="text-gray">{t`No round yet.`}</p>
  : [ <h2 className="font-h3">{t`Latest rounds`}</h2>
    , <div className="ark-batches">{ rounds.rounds.map(r => <div className="ark-batch">
        <div><a href={`ark/${r.number}`}>{t`Round #${r.number}`}</a>{' · '}{r.coins == 1 ? t`1 coin` : t`${formatNumber(r.coins)} coins`}{' · '}{r.words}</div>
        <div className="text-gray"><a href={`tx/${r.txid}`} className="mono">{short(r.txid)}</a></div>
      </div>) }</div> ]

export default ({ t, goArk: q, arkFind: f, arkRounds, ...S }) => layout(
  <div className="container ark-page">
    <h1 className="font-h2">{t`Ark`}</h1>
    <p className="text-gray">{t`Coins held off the chain, in batches. Each batch is one output of a round's transaction, and any coin in it can be taken onto the chain by its owner.`}</p>
    { searchBox(t, q) }
    { !q ? latest(arkRounds, { t })
      : !f ? <p className="text-gray">{t`Looking up…`}</p>
      : f.kind == 'round' ? roundView(f, { t, ...S })
      : f.kind == 'coin' ? coinView(f, { t, ...S })
      : f.kind == 'board' ? boardView(f, { t, ...S })
      : <p>{f.status == 400 ? t`Search by a round's txid or number, or by a coin's id.`
          : f.syncing ? t`Nothing found yet: the explorer is still reading the Ark's rounds. Try again in a few minutes.`
          : t`Nothing found: ${q} is not a round or a coin of the Ark.`}</p> }
  </div>
, { t, activeTab: 'ark', ...S })
