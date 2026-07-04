import { getMempoolDepth, squashFeeHistogram, feerateCutoff } from '../lib/fees'
import { formatSat, formatVMB } from './util'
import { nativeAssetLabel } from '../const'
import layout from './layout'
import search from './search'

let squashed

// SEQUENTIA (T1): a Sequentia fee is denominated in the fee asset's own base units,
// not Bitcoin "sat". The fee histogram/estimates electrs computes are in the native
// asset, so label the per-vByte rate "<nativeTicker>/vB" (matching the tx page). The
// Bitcoin testnet4 flavor (!IS_ELEMENTS) keeps the correct "sat/vB".
const FEE_RATE_UNIT = process.env.IS_ELEMENTS ? `${nativeAssetLabel}/vB` : 'sat/vB'

export default ({ t, mempool, feeEst, ...S }) => mempool && feeEst && layout(
  <div>
    <div className="mempool-page">
      <div className="container">
        <div>
          <h1 className="transaction-header-title font-h2">{t`Mempool`}</h1>
        </div>
        <div className="stats-table font-p2">
          <div>
            <div>{t`Total transactions`}</div>
            <div>{mempool.count}</div>
          </div>
          <div>
            <div>{t`Total fees`}</div>
            {/* SEQUENTIA (T1): fees may be paid in ANY asset (open fee market). electrs'
                total_fee is the native-asset-denominated total, so note that the figure
                covers the native-asset portion rather than implying one currency.
                TODO(browser-verify): confirm electrs sums only native-asset fee outputs. */}
            <div title={process.env.IS_ELEMENTS ? t`Fees may be paid in any accepted asset; this is the native-asset-denominated total.` : undefined}>
              {formatSat(mempool.total_fee)}
              { process.env.IS_ELEMENTS &&
                <span className="text-muted" style={{ fontSize: '0.8em', marginLeft: '6px' }}>{t`native-asset fees`}</span> }
            </div>
          </div>
          <div>
            <div>{t`Total size`}</div>
            <div>{formatVMB(mempool.vsize)}</div>
          </div>
        </div>
      </div>
    </div>
    <div className="container">
      <div className="mempool-layout">
        { mempool.fee_histogram.length > 0 &&
          <dl className="mempool-histogram">
            <h4 className="mempool-section-heading mb-3">Fee rate distribution</h4>
            { squashed = squashFeeHistogram(mempool.fee_histogram), squashed.map(([ rangeStart, binSize ], i) => binSize > 0 &&
              <dd>
                <span className="text">{`${rangeStart.toFixed(1)}${i == 0 ? '+' : ' - '+squashed[i-1][0].toFixed(1)}`}</span>
                <span className="bar" style={{width: `${binSize/mempool.vsize*100}%`}}>{formatVMB(binSize)}</span>
              </dd>
            )}
            <span className="label">{FEE_RATE_UNIT}</span>
          </dl>
        }

        { !!Object.keys(feeEst).length &&
          <div className="fee-estimates">
            <h4 className="mb-3">Fee rate estimates</h4>
            <table className="table">
                <thead><tr><th>Target</th><th>{FEE_RATE_UNIT}</th><th>Mempool depth</th></tr></thead>
                { sortEst(feeEst).map(([ target, feerate ]) =>
                  <tr><td>{t`${target} blocks`}</td><td>{feerate.toFixed(2)}</td><td>{t`${formatVMB(getMempoolDepth(mempool.fee_histogram, feerate))} from tip`}</td></tr>
                )}
            </table>
          </div>
        }
      </div>

    </div>
  </div>
, { ...S, t, mempool, feeEst })

const sortEst = feeEst => Object.entries(feeEst).sort((a, b) => a[0]-b[0])
