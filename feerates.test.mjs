// /feerates must publish the INTERSECTION of the nodes we broadcast to, at the
// MINIMUM rate.
//
// Two real gaps this closes:
//
//   1. WRONG NODE. /feerates read the explorer node alone, while POST /api/tx
//      submits to the producer AND the explorer. Two daemons, two independent
//      rate tables, coupled only by the price-server sidecar feeding both.
//   2. MEMBERSHIP IS NOT SUFFICIENT. The node computes
//      fee_atoms * its_own_rate / 1e8 >= minRelayTxFee, so an asset listed at a
//      rate far below what the wallet sized against is refused with a generic
//      "min relay fee not met" (proven in-tree at
//      test/functional/feature_any_asset_fee_scenarios.py).
//
//   node --test feerates.test.mjs
import assert from 'node:assert';
import test from 'node:test';
import { createRequire } from 'node:module';

const { intersectAtMinimum, combineFeeInfo } = createRequire(import.meta.url)('./feerates.js');

const GOLD = 'a1'.repeat(32), OILX = 'b2'.repeat(32), POLICY = 'c8'.repeat(32);

/** Build one node's normalised view. */
const node = (rates, labels = {}) => ({
  rates: new Map(Object.entries(rates)),
  label: new Map(Object.entries(labels)),
});

test('agreeing nodes publish the agreed rate', () => {
  const out = intersectAtMinimum([
    node({ [GOLD]: 400e8, [POLICY]: 1e8 }, { [GOLD]: 'GOLD', [POLICY]: 'bitcoin' }),
    node({ [GOLD]: 400e8, [POLICY]: 1e8 }),
  ]);
  assert.deepEqual(out, { GOLD: 400e8, bitcoin: 1e8 });
});

test('disagreeing nodes publish the MINIMUM, not the first or the highest', () => {
  const out = intersectAtMinimum([
    node({ [GOLD]: 400e8 }, { [GOLD]: 'GOLD' }),
    node({ [GOLD]: 250e8 }),
  ]);
  // The wallet sizes with ceil(floor * 1e8 / rate), so the LOWER rate yields MORE
  // atoms — enough to clear the floor at both nodes. Publishing 400e8 would
  // under-size the fee for the node that prices GOLD at 250e8.
  assert.equal(out.GOLD, 250e8);
});

test('the minimum is taken regardless of node order', () => {
  const a = node({ [GOLD]: 400e8 }, { [GOLD]: 'GOLD' });
  const b = node({ [GOLD]: 250e8 }, { [GOLD]: 'GOLD' });
  assert.equal(intersectAtMinimum([a, b]).GOLD, 250e8);
  assert.equal(intersectAtMinimum([b, a]).GOLD, 250e8);
});

test('an asset missing from ANY broadcast target is NOT offered', () => {
  const out = intersectAtMinimum([
    node({ [GOLD]: 400e8, [OILX]: 89e8 }, { [GOLD]: 'GOLD', [OILX]: 'OILX' }),
    node({ [GOLD]: 400e8 }),                 // this node never heard of OILX
  ]);
  assert.ok(!('OILX' in out), 'offering it would produce a refusal at the second node');
  assert.deepEqual(Object.keys(out), ['GOLD']);
});

test('the policy asset earns no exemption from the intersection', () => {
  // Since the node stopped falling back to 1:1 for an unlisted policy asset, a
  // policy asset missing from one node is exactly as unusable as any other.
  const out = intersectAtMinimum([
    node({ [GOLD]: 400e8, [POLICY]: 1e8 }, { [GOLD]: 'GOLD', [POLICY]: 'bitcoin' }),
    node({ [GOLD]: 400e8 }),
  ]);
  assert.ok(!('bitcoin' in out));
});

test('a single node degenerates to that node view (no change for a one-node deploy)', () => {
  const out = intersectAtMinimum([node({ [GOLD]: 400e8 }, { [GOLD]: 'GOLD' })]);
  assert.deepEqual(out, { GOLD: 400e8 });
});

test('no nodes publishes nothing rather than inventing a set', () => {
  assert.deepEqual(intersectAtMinimum([]), {});
});

test('hex keys survive when a node has no label for the asset', () => {
  const out = intersectAtMinimum([
    node({ [GOLD]: 400e8 }),                 // no label map at all
    node({ [GOLD]: 400e8 }),
  ]);
  assert.deepEqual(out, { [GOLD]: 400e8 }, 'the hex is a valid display key');
});

test('THE KEY-SPACE HAZARD: label-vs-hex must not silently empty the set', () => {
  // getfeeexchangerates keys by LABEL where the node has one and by hex
  // otherwise, and labels are per-node. If the caller intersected raw keys, one
  // node's "GOLD" would never match another's hex and the result would be empty —
  // which, now that an unlisted asset is simply not accepted, would take the
  // whole fee market off the wallet. nodeRatesByHex normalises before we get
  // here; this pins that the reducer is fed hex and therefore matches.
  const out = intersectAtMinimum([
    node({ [GOLD]: 400e8 }, { [GOLD]: 'GOLD' }),   // displays as a label
    node({ [GOLD]: 380e8 }),                       // displays as hex
  ]);
  assert.equal(out.GOLD, 380e8, 'the same asset must match across differing label configs');
});

// /feeinfo: how many of the nodes we broadcast to accept each fee asset.
const info = (hex, o = {}) => ({ asset: hex, label: o.label || hex.slice(0, 4), precision: 8,
  listed: o.accepted !== undefined ? true : false, accepted: !!o.accepted,
  registry_listed: !!o.registry, ...(o.price != null ? { market_price: o.price } : {}) });

test('feeinfo counts the nodes that accept each asset', () => {
  const producer = { [GOLD]: info(GOLD, { accepted: true, price: 4000, label: 'GOLD', registry: true }),
                     [OILX]: info(OILX, { accepted: true }) };
  const explorer = { [GOLD]: info(GOLD, { accepted: true, price: 4000, label: 'GOLD', registry: true }),
                     [OILX]: info(OILX, { accepted: false }) };
  const out = combineFeeInfo([producer, explorer]);
  assert.deepEqual(out[GOLD], { asset: GOLD, label: 'GOLD', precision: 8, registry_listed: true,
    market_price: 4000, accepted_by: 2, listed_by: 2, nodes: 2 });
  assert.equal(out[OILX].accepted_by, 1);      // some: amber
  assert.equal(out[OILX].listed_by, 2);        // the explorer lists it at rate zero: a refusal on purpose
  assert.equal(out[OILX].market_price, null);  // unquoted
});

test('listed at rate zero and not listed are told apart', () => {
  const out = combineFeeInfo([{ [OILX]: info(OILX, { accepted: false }) }, { [GOLD]: info(GOLD) }]);
  assert.equal(out[OILX].listed_by, 1); assert.equal(out[OILX].accepted_by, 0);
  assert.equal(out[GOLD].listed_by, 0); assert.equal(out[GOLD].accepted_by, 0);
});

test('an asset one node does not report counts as not accepted there', () => {
  const out = combineFeeInfo([{ [POLICY]: info(POLICY, { accepted: true, price: 0.37 }) }, {}]);
  assert.equal(out[POLICY].accepted_by, 1);
  assert.equal(out[POLICY].nodes, 2);
  assert.equal(out[POLICY].market_price, 0.37);
});

test('keys that are not asset ids are ignored, and no node is no asset', () => {
  assert.deepEqual(combineFeeInfo([{ bitcoin: { label: 'bitcoin', accepted: true } }]), {});
  assert.deepEqual(combineFeeInfo([]), {});
});
