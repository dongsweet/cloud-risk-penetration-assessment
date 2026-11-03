const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeConfig, evaluatePath, findPaths, analyzePaths, level } = require('../app/lib/risk-engine');

test('risk level maps boundary values', () => {
  assert.equal(level(0.2), '很低');
  assert.equal(level(0.2001), '低');
  assert.equal(level(0.6), '中');
  assert.equal(level(0.8001), '很高');
});

test('config rejects invalid weights and thresholds', () => {
  assert.throws(() => mergeConfig({ weights: { C: 1 } }), /权重/);
  assert.throws(() => mergeConfig({ thresholds: [ .2, .2, .6, .8 ] }), /阈值/);
  assert.throws(() => mergeConfig({ alpha: 1.2 }), /α/);
});

test('formula computes bounded penetration and tenant risk', () => {
  const cfg = mergeConfig();
  const source = { id: 'V1', riskName: '漏洞', probability: .5 };
  const target = { id: 'DB-A', name: '数据库', value: 1, importance: 1, sensitivity: 1, impact: 1 };
  const edge = { id: 'E1', factors: { C: 1, N: 1, P: 1, R: 1, E: 1, B: 1, I: 0 } };
  const r = evaluatePath(source, target, [ source, target ], [ edge ], cfg);
  assert.ok(r.penetration <= 1 && r.penetration >= 0);
  assert.ok(r.riskValue <= 1 && r.riskValue > 0);
  assert.equal(r.level, '高');
});

test('path traversal stops cycles and ignores inactive edges', () => {
  const nodes = [
    { id: 'S', layer: 'platform', risk_source: 1, probability: .3 },
    { id: 'A', layer: 'platform' },
    { id: 'T', layer: 'tenant', kind: 'database', value: .8, importance: .8, sensitivity: .8, impact: .8 }
  ];
  const factors = { C: .5, N: .5, P: .5, R: .5, E: .5, B: .5, I: .2 };
  const edges = [
    { from_id: 'S', to_id: 'A', active: true, factors },
    { from_id: 'A', to_id: 'S', active: true, factors },
    { from_id: 'A', to_id: 'T', active: false, factors }
  ];
  assert.equal(findPaths(nodes, edges, mergeConfig()).length, 0);
});

test('path traversal ignores relationships outside their effective time range', () => {
  const nodes = [
    { id: 'S', layer: 'platform', risk_source: 1, probability: .3 },
    { id: 'T', layer: 'tenant', kind: 'database', value: .8, importance: .8, sensitivity: .8, impact: .8 }
  ];
  const edge = { from_id: 'S', to_id: 'T', active: true, valid_to: '2000-01-01T00:00:00.000Z', factors: { C: .5, N: .5, P: .5, R: .5, E: .5, B: .5, I: .2 } };
  assert.equal(findPaths(nodes, [ edge ], mergeConfig()).length, 0);
});

test('analysis reports blocked candidates while excluding them from scoring', () => {
  const nodes = [
    { id: 'S', layer: 'platform', risk_source: 1, probability: .4 },
    { id: 'A', layer: 'platform' },
    { id: 'T', layer: 'tenant', kind: 'business', value: .8, importance: .9, sensitivity: .8, impact: .7 }
  ];
  const factors = { C: .7, N: .7, P: .8, R: .5, E: .7, B: .8, I: .2 };
  const result = analyzePaths(nodes, [
    { id: 'E1', from_id: 'S', to_id: 'A', active: true, factors },
    { id: 'E2', from_id: 'A', to_id: 'T', active: false, factors }
  ], mergeConfig());
  assert.equal(result.risks.length, 0);
  assert.equal(result.blockedCount, 1);
  assert.deepEqual(result.blockedEdges, [ 'E2' ]);
});

test('path result exposes penetration level and review rationale', () => {
  const cfg = mergeConfig();
  const result = evaluatePath({ id: 'S', layer: 'platform', risk_source: 1, probability: .5 }, { id: 'T', name: '核心库', layer: 'tenant', sensitivity: .9, importance: .9, value: .9, impact: .9 }, [ { id: 'S' }, { id: 'T' } ], [ { id: 'E', factors: { C: 1, N: 1, P: .8, R: .7, E: .8, B: 1, I: 0 } } ], cfg);
  assert.ok(result.penetrationLevel);
  assert.equal(result.reviewRequired, true);
  assert.ok(result.recommendation);
  assert.ok(result.priority <= 3);
});
