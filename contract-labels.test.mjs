// The contract labels of esplora/client/src/lib/contracts.js, on transactions
// recorded from a regtest chain through sequentia-electrs: a faucet drip (a
// Simplicity spend of the sequentia/faucet-drip template) and the transaction
// that funded the covenant, with the registry's contract index for that chain.
//   node --test contract-labels.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contractInputs, contractOutputs, contractName, revealedLeaf } from './esplora/client/src/lib/contracts.js'

const fixture = name => JSON.parse(readFileSync(new URL(`./test/fixtures/${name}.json`, import.meta.url), 'utf8'))
const index = fixture('contract-index')
const drip = fixture('drip-tx')
const funding = fixture('drip-funding-tx')
const DRIP = '12986f202fbfb850f7699c5d5188f261f276de6c7038142f0a28bbb672b5af34'
const CMR = '5251ec00d9799dbcdb31da4534f25ef9960321f195e2e24ef7125c46f24b972a'

test('a drip is labelled with its template and its path', () => {
  const ins = contractInputs(drip, index)
  assert.deepEqual(ins, [{ template_hash: DRIP, name: 'sequentia/faucet-drip', version: 1, leaf: 'drip', path: 'drip', cmr: CMR }])
  assert.equal(contractName(ins[0]), 'sequentia/faucet-drip v1')
  assert.equal(revealedLeaf(drip.vin[0].witness).script, CMR)
})

test('the successor reserve is the next state of the drip\'s input', () => {
  const outs = contractOutputs(drip, index)
  assert.equal(outs.length, 3)
  assert.equal(outs[0].successor_of, 0)
  assert.equal(outs[0].name, 'sequentia/faucet-drip')
  assert.equal(outs[0].path, null)
  assert.equal(outs[1], null, 'the drip itself pays an ordinary address')
  assert.equal(outs[2], null, 'the fee')
})

test('the funding output is the registered instance', () => {
  assert.ok(contractInputs(funding, index).every(c => c === null))
  const outs = contractOutputs(funding, index)
  const held = outs.map((c, i) => c && [i, c.name, c.successor_of])
  assert.deepEqual(held.filter(Boolean), [[outs.findIndex(Boolean), 'sequentia/faucet-drip', undefined]])
})

test('the root alone names the template, without the instance', () => {
  const rootOnly = { leaves: index.leaves, scripts: {} }
  assert.equal(contractInputs(drip, rootOnly)[0].name, 'sequentia/faucet-drip')
  assert.equal(contractOutputs(drip, rootOnly)[0].successor_of, 0)
  assert.ok(contractOutputs(funding, rootOnly).every(c => c === null))
})

test('nothing is labelled without the index, or for a root it does not hold', () => {
  assert.deepEqual(contractInputs(drip, {}), [null])
  assert.deepEqual(contractInputs(drip, null), [null])
  assert.deepEqual(contractOutputs(drip, {}), [null, null, null])
  assert.deepEqual(contractInputs(drip, { leaves: { ['00'.repeat(32)]: index.leaves[CMR] }, scripts: {} }), [null])
})

test('a root in two templates is ambiguous unless the instance says which', () => {
  const other = ['ab'.repeat(32), 'example/other', 3, 'spend', 'spend']
  const two = { leaves: { [CMR]: [...index.leaves[CMR], other] }, scripts: {} }
  const c = contractInputs(drip, two)[0]
  assert.equal(contractName(c), 'sequentia/faucet-drip or example/other')
  assert.equal(contractOutputs(drip, two)[0], null, 'no successor is claimed for an ambiguous input')
  assert.equal(contractInputs(drip, { ...two, scripts: index.scripts })[0].name, 'sequentia/faucet-drip')
})

test('a key-path or non-Simplicity spend reveals no Simplicity root', () => {
  assert.equal(revealedLeaf(['aa'.repeat(64)]), null)
  const tapscript = ['aa'.repeat(64), '20' + 'bb'.repeat(32) + 'ac', 'c4' + 'cc'.repeat(32)]
  assert.equal(revealedLeaf(tapscript).version, 0xc4)
  const annexed = [...drip.vin[0].witness, '50aa']
  assert.equal(revealedLeaf(annexed).script, CMR)
})
