import moveDec from 'move-decimal-point'
import { sat2btc } from 'fmtbtc'
import { nativeAssetId, nativeAssetLabel } from '../const'
import { isNativeOut } from '../util'

const DEFAULT_ISSUED_PRECISION = 0
    , NATIVE_PRECISION = 8

// SEQUENTIA: local display preferences (chosen on the Settings page, persisted in
// localStorage). Read once at module load; changing one persists + reloads (app.js)
// so every displayed value re-renders consistently.
const _ls = k => (typeof localStorage !== 'undefined' && localStorage.getItem(k)) || ''
const NUMFMT = _ls('seqNumFmt') || 'plain'                          // plain | grouped | european
const _GSEP  = ({ plain: '', grouped: ',', european: '.' })[NUMFMT] || ''   // thousands separator
const _DSEP  = ({ plain: '.', grouped: '.', european: ',' })[NUMFMT] || '.' // decimal separator
const groupDigits = whole => _GSEP ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, _GSEP) : whole
// Format a JS number to <=maxdp decimals, strip trailing zeros, then apply the chosen
// grouping + decimal separator. Used for the "≈ ref" values.
const fmtDec = (num, maxdp) => {
  if (num == null) return ''
  let str = Number(num).toFixed(maxdp)
  if (str.indexOf('.') >= 0) str = str.replace(/0+$/, '').replace(/\.$/, '')
  let [ whole, dec ] = str.split('.'), sign = ''
  if (whole[0] === '-') { sign = '-'; whole = whole.slice(1) }
  return sign + groupDigits(whole) + (dec ? _DSEP + dec : '')
}
const DATE_UTC = _ls('seqDateUTC') === '1'                          // show times in UTC vs local

const pad = n => n < 10 ? '0'+n : n

const formatTimezone = time => {
  const tzOffset = time.getTimezoneOffset() * -1;
  return tzOffset == 0 ? 'UTC' : 'GMT ' + (tzOffset < 0 ? '' : '+') + (tzOffset/60)
}

export const formatTime = (unix, with_tz = true) => {
  const time = new Date(unix*1000)
  // SEQUENTIA: honour the Settings "show times in UTC" preference.
  const Y  = DATE_UTC ? time.getUTCFullYear() : time.getFullYear()
      , Mo = (DATE_UTC ? time.getUTCMonth() : time.getMonth()) + 1
      , D  = DATE_UTC ? time.getUTCDate() : time.getDate()
      , H  = DATE_UTC ? time.getUTCHours() : time.getHours()
      , Mi = DATE_UTC ? time.getUTCMinutes() : time.getMinutes()
      , Sx = DATE_UTC ? time.getUTCSeconds() : time.getSeconds()

  return `${Y}-${pad(Mo)}-${pad(D)} ${pad(H)}:${pad(Mi)}:${pad(Sx)}`
       + (with_tz ? ' ' + (DATE_UTC ? 'UTC' : formatTimezone(time)) : '')
}

export const formatSat = (sats, label=nativeAssetLabel) => `${formatNumber(sat2btc(sats), NATIVE_PRECISION)} ${label}`

export const formatAssetAmount = (value, precision=0, t) =>
  <span>
    {formatNumber(precision > 0 ? moveDec(value, -precision) : value, precision)}
  </span>

export const formatOutAmount = (vout, { t, assetMap, prices }, shortDisplay=false) => {
  if (vout.value == null) return t`Confidential`

  // SEQUENTIA: a "≈ <ref>" suffix in the user-chosen reference currency (empty if unpriced).
  const refEl = refValueEl(vout.asset, vout.value, assetMap, prices)
      , ref = refEl ? <span>{' '}{refEl}</span> : ''

  if (isNativeOut(vout)) {
    return <span>
      {formatNumber(sat2btc(vout.value), NATIVE_PRECISION)}
      { ' ' }
      {!vout.asset ? nativeAssetLabel : <a href={`asset/${vout.asset}`}>{nativeAssetLabel}</a>}
      {ref}
    </span>
  }

  const [ domain, ticker, name, _precision ] = vout.asset && assetMap && assetMap[vout.asset] || []
      , precision = _precision != null ? _precision : DEFAULT_ISSUED_PRECISION
      , short_id = vout.asset && vout.asset.substr(0, 10)
      , asset_url = vout.asset && `asset/${vout.asset}`

  const amount_el = formatAssetAmount(vout.value, precision, t)
      , asset_link = vout.asset && <a href={asset_url}>{short_id}</a>

  const out = domain ? <span>{amount_el} {ticker && <span title={name}>{ticker}</span>} {shortDisplay||<br />} {domain}{shortDisplay || [<br/>,<em title={vout.asset}>{asset_link}</em>]}</span>
            : vout.asset ? <span>{amount_el} <em title={vout.asset}>{asset_link}</em></span>
            : <span>{amount_el} {t`Unknown`}</span> // should never happen
  return ref ? <span>{out}{ref}</span> : out
}

// SEQUENTIA: format a raw (asset, value) pair as a compact "amount TICKER" string,
// using the asset registry for ticker + precision. The native asset and unknown
// assets are both handled; an unknown asset falls back to a short id. Returns a
// plain string (not JSX) so it can be used in tables, hover titles and links.
export const formatAssetValue = (asset, value, assetMap = {}) => {
  if (value == null) return ''
  if (!asset || asset === nativeAssetId) {
    return `${formatNumber(sat2btc(value), NATIVE_PRECISION)} ${nativeAssetLabel}`
  }
  const [ , ticker, , _precision ] = (assetMap && assetMap[asset]) || []
      , precision = _precision != null ? _precision : DEFAULT_ISSUED_PRECISION
      , amount = formatNumber(precision > 0 ? moveDec(value, -precision) : value, precision)
      , label = ticker || `${asset.substr(0, 6)}…`
  return `${amount} ${label}`
}

// SEQUENTIA: the ticker for an asset (native asset and unknown assets handled).
export const tickerOf = (asset, assetMap = {}) => {
  if (!asset || asset === nativeAssetId) return nativeAssetLabel
  const meta = assetMap && assetMap[asset]
  return (meta && meta[1]) || `${asset.substr(0, 6)}…`
}

// SEQUENTIA: a fee rate per vByte (in the fee asset's base units). One decimal for
// normal rates; for sub-unit rates show enough precision to avoid a misleading 0.0.
export const formatFeeRate = rate =>
  !isFinite(rate) || rate <= 0 ? '0'
  : rate >= 1 ? rate.toFixed(1)
  : parseFloat(rate.toPrecision(2)).toString()

// SEQUENTIA: list every explicit (asset, value) transfer equally — no headline/primary asset.
// In the open fee market the native asset (tSEQ) is often just change or fee, so promoting any
// single asset misleads; show them all compactly, e.g. "1,000 USDX, 0.5 tSEQ".
export const formatAssetValues = (outValues, assetMap = {}) =>
  outValues.map(v => formatAssetValue(v.asset, v.value, assetMap)).join(', ')

// ----- reference-currency valuation (explorer-wide, user-chosen denomination) -----
// SEQUENTIA: value any displayed amount in a denomination the user picks (USD, BTC, or
// any priced asset) — chosen via the navbar picker, persisted in localStorage. Prices come
// from /prices (per-asset base/USD price); value = amount * price[asset] / price[ref].
// Display-only: an absent feed or an unpriced asset simply renders no "≈".
export const REF = (typeof localStorage !== 'undefined' && localStorage.getItem('seqRefCcy')) || 'USD'
const priceTickerFor = (asset, assetMap) =>
  (!asset || asset === nativeAssetId) ? 'SEQ'                                   // native tSEQ is priced as SEQ
  : ((assetMap && assetMap[asset] && assetMap[asset][1]) || '').toUpperCase()   // registry ticker
const refUnitPrice = (prices, ref) => ref === 'USD' ? 1 : (prices && prices[ref === 'BTC' ? 'WBTC' : ref]) || null
const refPrecisionOf = (asset, assetMap) =>
  (!asset || asset === nativeAssetId) ? NATIVE_PRECISION
  : ((assetMap && assetMap[asset] && assetMap[asset][3] != null) ? assetMap[asset][3] : DEFAULT_ISSUED_PRECISION)
const refValueNum = (asset, value, assetMap, prices) => {
  if (value == null || !prices) return null
  const pu = prices[priceTickerFor(asset, assetMap)], pr = refUnitPrice(prices, REF)
  if (!(pu > 0) || !(pr > 0)) return null
  return (Number(value) / Math.pow(10, refPrecisionOf(asset, assetMap))) * pu / pr
}
const fmtRef = v => {
  if (v == null) return ''
  const dp = REF === 'BTC' ? 8 : (Math.abs(v) >= 1 ? 2 : 6)
  return '≈ ' + fmtDec(v, dp) + ' ' + REF
}
// a muted "≈ X REF" span (inline-styled so it needs no stylesheet), or '' if unpriced.
const refSpan = str => str ? <span className="ref-value" style={{ opacity: '0.7', fontSize: '0.85em', whiteSpace: 'nowrap' }}>{str}</span> : ''
// "≈ X REF" for a single (asset, sats) pair.
export const refValueStr = (asset, value, assetMap, prices) => fmtRef(refValueNum(asset, value, assetMap, prices))
export const refValueEl  = (asset, value, assetMap, prices) => refSpan(refValueStr(asset, value, assetMap, prices))
// "≈ X REF" for the SUM of a list of {asset,value} (mixed assets), or '' if none priced.
export const refValueOfListStr = (outValues, assetMap, prices) => {
  if (!outValues || !prices) return ''
  let sum = 0, any = false
  for (const o of outValues) { const v = refValueNum(o.asset, o.value, assetMap, prices); if (v != null) { sum += v; any = true } }
  return any ? fmtRef(sum) : ''
}
export const refValueOfListEl = (outValues, assetMap, prices) => refSpan(refValueOfListStr(outValues, assetMap, prices))
// reference options for the Settings picker. Canonical order: BTC, USD, SEQ first
// (always shown), then every other priced asset from the registry, alphabetically.
// WBTC is shown as BTC; the current selection is kept present even if unpriced.
export const refOptions = prices => {
  const head = ['BTC', 'USD', 'SEQ']
  const rest = new Set()
  if (prices) for (const k of Object.keys(prices)) {
    const t = (k === 'WBTC' ? 'BTC' : k).toUpperCase()
    if (!head.includes(t)) rest.add(t)
  }
  if (REF && !head.includes(REF)) rest.add(REF)
  return [...head, ...[...rest].sort()]
}

// SEQUENTIA: per-asset totals of a full tx's EXPLICIT outputs (for the detail view), excluding
// the fee output and any blinded output. Mirrors the backend's `out_values` (overview), so a tx
// with a blinded CHANGE output but an explicit payment still shows the payment, not "Confidential".
export const explicitOutValues = vout => {
  const totals = new Map()
  for (const o of vout || []) {
    if (o.scriptpubkey_type === 'fee') continue
    if (o.value == null) continue // blinded value
    const asset = o.asset || nativeAssetId
    totals.set(asset, (totals.get(asset) || 0) + o.value)
  }
  return [...totals].map(([asset, value]) => ({ asset, value }))
}

export const formatHex = num => {
  const str = num.toString(16)
  return '0x' + (str.length%2 ? '0' : '') + str
}

// Formats a number for display. Treats the number as a string to avoid rounding errors.
export const formatNumber = (s, precision=null) => {
  let [ whole, dec ] = s.toString().split('.'), sign = ''
  if (whole[0] === '-') { sign = '-'; whole = whole.slice(1) }

  if (precision != null && precision > 0) {
    if (dec == null) dec = '0'.repeat(precision)
    else if (dec.length < precision) dec += '0'.repeat(precision - dec.length)
  }

  // SEQUENTIA: apply the Settings number format (thousands grouping + decimal mark).
  return sign + groupDigits(whole) + (dec != null ? _DSEP + dec : '')
}

export const formatRelativeTime = (fromDate, toDate = new Date()) => {
  if (typeof fromDate === 'number') {
    fromDate = fromDate < 1e12
      ? new Date(fromDate * 1000)
      : new Date(fromDate)
  }

  const diffSeconds = Math.floor((toDate - fromDate) / 1000)

  if (diffSeconds < 5) return 'just now'
  if (diffSeconds < 60) return `${diffSeconds} seconds ago`

  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) {
    return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`
  }

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`
  }

  const diffDays = Math.floor(diffHours / 24)
  return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`
}

export const getBlockPercentageUsed = blockWeight =>
  Math.round((blockWeight / 4000000) * 10000) / 100

export const formatJson = obj =>
  JSON.stringify(obj, null, 1)
    //.replace(/^ /mg, '')
    //.replace(/^\{|\}$/g, '')

// Rewrite a loopback URL's host to the host the page was actually loaded from
// (keeping the port), so links to sibling explorer instances (e.g. our Bitcoin
// testnet4 explorer on :5002) work over localhost, Tailscale, or a reverse proxy.
// Non-loopback (external) URLs are left untouched, and SSR returns the URL as-is.
export const rebaseHost = url => {
  if (!process.browser) return url
  try {
    const u = new URL(url, window.location.href)
    if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)) {
      u.protocol = window.location.protocol
      u.hostname = window.location.hostname
    }
    return u.toString()
  } catch (e) {
    return url
  }
}

const parentChainExplorerTxOut = process.env.PARENT_CHAIN_EXPLORER_TXOUT || '/tx/{txid}?output:{vout}'
const parentChainExplorerAddr  = process.env.PARENT_CHAIN_EXPLORER_ADDR || '/address/{addr}'
const parentChainExplorerBlock = process.env.PARENT_CHAIN_EXPLORER_BLOCK || 'https://mempool.space/testnet4/block/{hash}'

export const linkToParentOut = ({ txid, vout }, label=`${txid}:${vout}`) =>
  <a href={parentChainExplorerTxOut.replace('{txid}', txid).replace('{vout}', vout)} target="_blank" rel="external">{label}</a>

export const linkToParentAddr = (addr, label=addr) =>
  <a href={parentChainExplorerAddr.replace('{addr}', addr)} target="_blank" rel="external">{label}</a>

// SEQUENTIA: link a block's Bitcoin anchor to the parent chain's explorer (our
// own Bitcoin testnet4 esplora instance), host-relative via rebaseHost.
export const linkToParentBlock = (hash, label=hash) =>
  <a href={rebaseHost(parentChainExplorerBlock.replace('{hash}', hash))} target="_blank" rel="noopener noreferrer">{label}</a>

export const linkToAddr = addr => <a href={`address/${addr}`}>{addr}</a>

export const formatVMB = (bytes, suffix) =>
  bytes >= 10000 || bytes == 0 ? `${(bytes / 1000000).toFixed(2)} ${suffix ?? "vMB"}`
: `< 0.01 ${suffix ?? "vMB"}`


export const strTruncate  = (str) => str.substr(0, 10) + '...' + str.substr(str.length-4, str.length);

export const truncateTxid  = (txid) => txid.substr(0, 5) + '...' + txid.substr(txid.length - 5, txid.length);

// Convert hex string to base64
export const hexToBase64 = (hex) => {
    return Buffer.from(hex, 'hex').toString('base64')
}
