// /feeinfo must publish the STRICTEST figure of the nodes we broadcast to, and
// fee levels that are ordered, never under the relay floor, and honest about
// how long they take.
//
//   node --test feeinfo.test.mjs
import assert from 'node:assert';
import test from 'node:test';
import { createRequire } from 'node:module';

const { feeInfo, feeTiers, etaBlocks } = createRequire(import.meta.url)('./feeinfo.js');

// getmempoolcongestion as a 25.2.1 node prints it on an idle testnet.
const congestion = (over = {}) => ({
  size: 0, bytes: 0, backlog_blocks: 0, next_block_txs: 0, next_block_weight: 0,
  next_block_full: false, next_block_min_feerate: 0.000001, next_block_min_atoms_per_kvb: 100,
  mempoolminfee: 0.000001, minrelaytxfee: 0.000001, incrementalrelayfee: 0.000001,
  ...over,
});
// estimatesmartfee as it answers on a chain with no history.
const noData = { errors: ['Insufficient data or no feerate found'], blocks: 2 };
const est = atoms => ({ feerate: atoms / 1e8, blocks: 2 });
const quiet = { 2: noData, 3: noData, 6: noData, 12: noData };
const node = (c = {}, estimates = quiet) => ({ congestion: congestion(c), estimates });
const rates = out => Object.fromEntries(Object.entries(out.tiers).map(([k, v]) => [k, v.feerate]));

test('an idle network: everything sits on the relay floor and takes one block', () => {
  const out = feeInfo([node(), node()]);
  assert.equal(out.floor, 100);
  assert.equal(out.next_block, 100);
  assert.equal(out.next_block_full, false);
  assert.deepEqual(out.estimates, { 2: null, 3: null, 6: null, 12: null });
  assert.deepEqual(rates(out), { low: 110, medium: 225, high: 400, highest: 800 });
  for (const t of Object.values(out.tiers)) assert.equal(t.blocks, 1);
});

test('a full block lifts every level except low, and low no longer promises a block', () => {
  const out = feeInfo([node({ next_block_full: true, next_block_min_atoms_per_kvb: 1000, size: 900, bytes: 400000, backlog_blocks: 3.2 })]);
  assert.equal(out.next_block, 1000);
  assert.equal(out.backlog_blocks, 3.2);
  assert.deepEqual(rates(out), { low: 110, medium: 1350, high: 2200, highest: 4400 });
  assert.equal(out.tiers.low.blocks, null, 'below the cut with no history: no number to give');
  assert.equal(out.tiers.medium.blocks, 1);
});

test('history lifts a level the queue alone would have priced too low', () => {
  // The queue says 1000 to get in; history says the last bursts needed 3000 for 2 blocks.
  const out = feeInfo([node({ next_block_full: true, next_block_min_atoms_per_kvb: 1000 },
    { 2: est(3000), 3: est(1800), 6: est(600), 12: est(150) })]);
  assert.deepEqual(out.estimates, { 2: 3000, 3: 1800, 6: 600, 12: 150 });
  assert.equal(out.tiers.medium.feerate, 1800, 'medium ≥ E(3)');
  assert.equal(out.tiers.high.feerate, 3000, 'high ≥ E(2)');
  assert.equal(out.tiers.highest.feerate, 4500, 'highest ≥ 1.5 E(2)');
  assert.equal(out.tiers.low.blocks, null, '110 meets no estimate, not even E(12) = 150');
});

test('a level under the cut gets the blocks history supports', () => {
  assert.equal(etaBlocks(700, 1000, true, { 2: 3000, 3: 1800, 6: 600, 12: 150 }), 6);
  assert.equal(etaBlocks(200, 1000, true, { 2: 3000, 3: 1800, 6: 600, 12: 150 }), 12);
  assert.equal(etaBlocks(1000, 1000, true, {}), null, 'a tie with the cut on a full block loses');
  assert.equal(etaBlocks(1001, 1000, true, {}), 1);
  assert.equal(etaBlocks(100, 100, false, {}), 1, 'a block with room takes everything that relays');
});

test('the STRICTEST node wins, whichever it is', () => {
  const a = node();
  const b = node({ minrelaytxfee: 0.000005, mempoolminfee: 0.000005, next_block_min_atoms_per_kvb: 500 },
    { 2: est(900), 3: noData, 6: noData, 12: noData });
  const c = node({}, { 2: est(700), 3: est(400), 6: noData, 12: noData });
  // POST /api/tx submits to all of them, so a fee sized on a's floor would be refused by b.
  for (const order of [[a, b, c], [c, b, a], [b, c, a]]) {
    const out = feeInfo(order);
    assert.equal(out.floor, 500);
    assert.equal(out.next_block, 500);
    assert.deepEqual(out.estimates, { 2: 900, 3: 400, 6: null, 12: null });
  }
});

test('one node full is enough to call the block full', () => {
  const out = feeInfo([node(), node({ next_block_full: true, next_block_min_atoms_per_kvb: 800 })]);
  assert.equal(out.next_block_full, true);
  assert.equal(out.next_block, 800);
});

test('a trimming mempool raises the floor above minrelaytxfee', () => {
  const out = feeInfo([node({ mempoolminfee: 0.000003 })]);
  assert.equal(out.floor, 300);
  assert.equal(out.next_block, 300, 'the next block can never be cheaper than entering the mempool');
});

test('the levels are strictly increasing and low clears the floor', () => {
  const E = [{}, { 2: 50, 3: 9000 }, { 2: 100000, 3: 1, 6: 1, 12: 1 }, { 3: 5000 }];
  for (const [F, N, I] of [[100, 100, 100], [100, 101, 100], [1, 1, 1], [1, 1, 0], [100, 10000, 100], [7, 7, 0]]) {
    for (const e of E) {
      const t = feeTiers(F, N, I, e);
      const msg = JSON.stringify({ F, N, I, e, t });
      assert.ok(t.low > F, msg);
      assert.ok(t.low < t.medium && t.medium < t.high && t.high < t.highest, msg);
      assert.ok(t.medium > N, msg);
    }
  }
});

test('an estimate that fails to answer is a missing estimate, not a failed endpoint', () => {
  const out = feeInfo([node({}, { 2: null, 3: est(400), 6: undefined, 12: noData })]);
  assert.deepEqual(out.estimates, { 2: null, 3: 400, 6: null, 12: null });
});

test('a node answer without a floor is refused, not guessed', () => {
  assert.equal(feeInfo([node(), node({ minrelaytxfee: undefined })]), null);
  assert.equal(feeInfo([node({ next_block_min_atoms_per_kvb: 'x' })]), null);
  assert.equal(feeInfo([node(), undefined]), null);
});

test('no nodes publishes nothing rather than inventing a market', () => {
  assert.equal(feeInfo([]), null);
});
