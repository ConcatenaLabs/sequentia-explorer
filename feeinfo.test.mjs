// /feeinfo must publish the STRICTEST figure of the nodes we broadcast to, and
// fee levels that are ordered and never under the relay floor.
//
//   node --test feeinfo.test.mjs
import assert from 'node:assert';
import test from 'node:test';
import { createRequire } from 'node:module';

const { feeInfo, feeTiers } = createRequire(import.meta.url)('./feeinfo.js');

// getmempoolcongestion as a 25.2.1 node prints it on an idle testnet.
const idle = (over = {}) => ({
  size: 0, bytes: 0, backlog_blocks: 0, next_block_txs: 0, next_block_weight: 0,
  next_block_full: false, next_block_min_feerate: 0.000001, next_block_min_atoms_per_kvb: 100,
  mempoolminfee: 0.000001, minrelaytxfee: 0.000001, incrementalrelayfee: 0.000001,
  ...over,
});

test('an idle network: everything sits on the relay floor', () => {
  const out = feeInfo([idle(), idle()]);
  assert.equal(out.floor, 100);
  assert.equal(out.next_block, 100);
  assert.equal(out.next_block_full, false);
  assert.deepEqual(out.tiers, { low: 110, medium: 225, high: 400, highest: 800 });
});

test('a full block lifts every level except low', () => {
  const out = feeInfo([idle({ next_block_full: true, next_block_min_atoms_per_kvb: 1000, size: 900, bytes: 400000, backlog_blocks: 3.2 })]);
  assert.equal(out.next_block, 1000);
  assert.equal(out.next_block_full, true);
  assert.equal(out.backlog_blocks, 3.2);
  assert.deepEqual(out.tiers, { low: 110, medium: 1350, high: 2200, highest: 4400 });
});

test('the STRICTEST node wins, whichever it is', () => {
  const a = idle();
  const b = idle({ minrelaytxfee: 0.000005, mempoolminfee: 0.000005, next_block_min_atoms_per_kvb: 500 });
  // POST /api/tx submits to both, so a fee sized on a's floor would be refused by b.
  for (const order of [[a, b], [b, a]]) {
    const out = feeInfo(order);
    assert.equal(out.floor, 500);
    assert.equal(out.next_block, 500);
  }
});

test('one node full is enough to call the block full', () => {
  const out = feeInfo([idle(), idle({ next_block_full: true, next_block_min_atoms_per_kvb: 800 })]);
  assert.equal(out.next_block_full, true);
  assert.equal(out.next_block, 800);
});

test('a trimming mempool raises the floor above minrelaytxfee', () => {
  const out = feeInfo([idle({ mempoolminfee: 0.000003 })]);
  assert.equal(out.floor, 300);
  assert.equal(out.next_block, 300, 'the next block can never be cheaper than entering the mempool');
});

test('the levels are strictly increasing and low clears the floor', () => {
  for (const [F, N, I] of [[100, 100, 100], [100, 101, 100], [1, 1, 1], [1, 1, 0], [100, 10000, 100], [7, 7, 0]]) {
    const t = feeTiers(F, N, I);
    assert.ok(t.low > F, `low ${t.low} must clear the floor ${F}`);
    assert.ok(t.low < t.medium && t.medium < t.high && t.high < t.highest, JSON.stringify({ F, N, I, t }));
    assert.ok(t.medium > N, 'medium must beat the next-block cut, not tie it');
  }
});

test('a node answer without a floor is refused, not guessed', () => {
  assert.equal(feeInfo([idle(), idle({ minrelaytxfee: undefined })]), null);
  assert.equal(feeInfo([idle({ next_block_min_atoms_per_kvb: 'x' })]), null);
});

test('no nodes publishes nothing rather than inventing a market', () => {
  assert.equal(feeInfo([]), null);
});
