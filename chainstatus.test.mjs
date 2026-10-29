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
