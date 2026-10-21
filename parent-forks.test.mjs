// /testnet4/forks names the competing testnet4 chains near the tip, the reason Sequentia's anchor
// stops: the getchaintips of 21/10/2026, two 35-block branches from 157183.
//
//   node --test parent-forks.test.mjs
import assert from 'node:assert';
import test from 'node:test';
import { createRequire } from 'node:module';

const { competingBranches } = createRequire(import.meta.url)('./parent-forks.js');

const TIPS = [
  { height: 157217, hash: 'a', branchlen: 35, status: 'valid-headers' },
  { height: 157217, hash: 'b', branchlen: 0, status: 'active' },
  { height: 157200, hash: 'c', branchlen: 18, status: 'valid-headers' },     // fell 17 behind
  { height: 157196, hash: 'd', branchlen: 1, status: 'valid-fork' },
  { height: 157215, hash: 'e', branchlen: 2, status: 'invalid' },
];

test('a branch as long as the active chain contests it from where it forked', () => {
  assert.deepEqual(competingBranches(TIPS), {
    tip: 157217, contested_from: 157183,
    branches: [{ height: 157217, forked_at: 157183, status: 'valid-headers' }],
  });
});

test('stale and invalid branches are not a contest', () => {
  assert.deepEqual(competingBranches(TIPS.filter(t => t.hash !== 'a')), { tip: 157217, contested_from: null, branches: [] });
  assert.equal(competingBranches(TIPS, { near: 20 }).branches.length, 2);
  assert.deepEqual(competingBranches([]), { tip: null, contested_from: null, branches: [] });
});
