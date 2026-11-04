import { linkToParentBlock } from './util'

// SEQUENTIA: how final a block is, and so every transaction in it, from the
// indexer's status (`bitcoin_anchor` and `certification`, on /tx/:txid,
// /tx/:txid/status and /block/:hash/status). The transaction page and the
// block page show the same two rows in the same words.
//
// The words follow the chain's rule exactly: a block the committee certified
// cannot be replaced by any competing Sequentia block, and it is still undone
// whenever Bitcoin drops the block it is anchored to, however deep.

const deep = (d, t) => d == 1 ? t`1 Bitcoin block deep` : t`${d} Bitcoin blocks deep`

// The rows, or [] when the status carries neither (unconfirmed, a stale block,
// or an indexer that does not report them). `self` names the block from the
// page's side: t`this block` or t`the block holding this transaction`.
export const finalityRows = (status, self, t) => {
  if (!status) return []
  const a = status.bitcoin_anchor, c = status.certification
  const anchorWords = a ? t`; it is undone only if Bitcoin drops block #${a.height} from its chain` : ''
  return [
    c && <div className="seq-finality">
      <div>{t`Finality`}</div>
      <div>{c.certified
        ? [<span className="seq-finalized">{t`Certified`}</span>, ' ',
           <span className="text-gray">{t`No competing Sequentia block can replace ${self}${anchorWords}.`}</span>]
        : [<span className="seq-unfinalized">{t`Not certified`}</span>, ' ',
           <span className="text-gray">{c.quorum != null
             ? (c.signers == 1 ? t`1 committee signature of the ${c.quorum} needed, so a competing Sequentia block can still replace ${self}.` : t`${c.signers} committee signatures of the ${c.quorum} needed, so a competing Sequentia block can still replace ${self}.`)
             : t`A competing Sequentia block can still replace ${self}.`}</span>]
      }</div>
    </div>
  , a && <div className="seq-anchor">
      <div>{t`Bitcoin anchor`}</div>
      <div className="mono">
        {linkToParentBlock(a.hash, `#${a.height}`)}{' '}
        <span className="text-gray">{deep(a.depth, t)}</span>
      </div>
    </div>
  ].filter(Boolean)
}
