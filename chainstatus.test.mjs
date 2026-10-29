import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const { chainVerdict } = createRequire(import.meta.url)('./chainstatus.js')

const info = (time, blocks = 100) => ({ blocks, bestblockhash: 'ab'.repeat(32), time })
const anchor = (anchorheight, anchorstatus = 'ok') => ({ anchorheight, anchorstatus })
const NOW = 1_800_000_000

test('a fresh tip with a checked anchor at the Bitcoin tip is healthy', () => {
  const v = chainVerdict({ info: info(NOW - 40), anchor: anchor(500), btcHeight: 501, now: NOW })
  assert.equal(v.height, 100)
  assert.deepEqual(v.blocks, { ok: true, state: 'on_time', age_seconds: 40 })
  assert.equal(v.anchor.ok, true)
  assert.equal(v.anchor.state, 'current')
  assert.equal(v.anchor.behind, 1)
})

test('block age crosses late, then stalled', () => {
  assert.equal(chainVerdict({ info: info(NOW - 300), anchor: anchor(1), btcHeight: 1, now: NOW }).blocks.state, 'on_time')
  const late = chainVerdict({ info: info(NOW - 301), anchor: anchor(1), btcHeight: 1, now: NOW }).blocks
  assert.deepEqual([late.ok, late.state], [false, 'late'])
  const stalled = chainVerdict({ info: info(NOW - 901), anchor: anchor(1), btcHeight: 1, now: NOW }).blocks
  assert.deepEqual([stalled.ok, stalled.state], [false, 'stalled'])
})

test('a tip time ahead of the clock counts as age zero', () => {
  assert.equal(chainVerdict({ info: info(NOW + 20), anchor: anchor(1), btcHeight: 1, now: NOW }).blocks.age_seconds, 0)
})

test('an anchor too far behind Bitcoin is not current', () => {
  const ok = chainVerdict({ info: info(NOW), anchor: anchor(494), btcHeight: 500, now: NOW }).anchor
  assert.deepEqual([ok.ok, ok.behind], [true, 6])
  const v = chainVerdict({ info: info(NOW), anchor: anchor(493), btcHeight: 500, now: NOW }).anchor
  assert.deepEqual([v.ok, v.state, v.behind], [false, 'behind', 7])
})

test('an anchor the node could not check is never current', () => {
  for (const s of ['not_found', 'stale', 'height_mismatch', 'no_connection', 'not_validated']) {
    const v = chainVerdict({ info: info(NOW), anchor: anchor(500, s), btcHeight: 500, now: NOW }).anchor
    assert.deepEqual([v.ok, v.state, v.check], [false, 'unchecked', s])
  }
})

test('an unknown Bitcoin tip leaves the anchor unconfirmed', () => {
  const v = chainVerdict({ info: info(NOW), anchor: anchor(500), btcHeight: null, now: NOW }).anchor
  assert.deepEqual([v.ok, v.state, v.behind, v.bitcoin_height], [false, 'bitcoin_unknown', null, null])
})

test('an anchor held below a contested Bitcoin chain is waiting, not a fault', () => {
  // testnet4 split at 158097: three tips above it; the node anchors at 158096
  const forks = { tip: 158102, contested_from: 158097, branches: [{ height: 158102, forked_at: 158097, status: 'valid-headers' }] }
  const v = chainVerdict({ info: info(NOW), anchor: anchor(158096), btcHeight: 158102, forks, now: NOW }).anchor
  assert.deepEqual([v.ok, v.state, v.behind, v.contested_from], [true, 'waiting', 6, 158097])
  // many blocks behind: still waiting while the split stands
  const far = chainVerdict({ info: info(NOW), anchor: anchor(158096), btcHeight: 158120, forks: { ...forks, tip: 158120 }, now: NOW }).anchor
  assert.deepEqual([far.ok, far.state], [true, 'waiting'])
  // an anchor behind a split it is not held by (below the shared height) is behind
  const below = chainVerdict({ info: info(NOW), anchor: anchor(158080), btcHeight: 158102, forks, now: NOW }).anchor
  assert.deepEqual([below.ok, below.state], [false, 'behind'])
  // settled: no competing branch, at the tip
  const settled = chainVerdict({ info: info(NOW), anchor: anchor(158108), btcHeight: 158108, forks: { tip: 158108, contested_from: null, branches: [] }, now: NOW }).anchor
  assert.deepEqual([settled.ok, settled.state], [true, 'current'])
  // the anchor checked but not held: a branch elsewhere changes nothing
  assert.equal(chainVerdict({ info: info(NOW), anchor: anchor(158096, 'stale'), btcHeight: 158102, forks, now: NOW }).anchor.state, 'unchecked')
})
