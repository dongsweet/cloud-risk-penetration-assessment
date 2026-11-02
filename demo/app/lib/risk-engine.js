'use strict';

const DEFAULTS = Object.freeze({
  weights: Object.freeze({ C: 1 / 7, N: 1 / 7, P: 1 / 7, R: 1 / 7, E: 1 / 7, B: 1 / 7, I: 1 / 7 }),
  lossWeights: Object.freeze({ Av: .25, K: .25, D: .25, Ic: .25 }),
  alpha: .5,
  thresholds: Object.freeze([ .2, .4, .6, .8 ])
});

function level(value, thresholds = DEFAULTS.thresholds) {
  if (value <= thresholds[0]) return '很低';
  if (value <= thresholds[1]) return '低';
  if (value <= thresholds[2]) return '中';
  if (value <= thresholds[3]) return '高';
  return '很高';
}

function mergeConfig(stored = {}, options = {}) {
  const cfg = {
    ...DEFAULTS,
    ...stored,
    ...options,
    weights: { ...DEFAULTS.weights, ...(stored.weights || {}), ...(options.weights || {}) },
    lossWeights: { ...DEFAULTS.lossWeights, ...(stored.lossWeights || {}), ...(options.lossWeights || {}) },
    thresholds: options.thresholds || stored.thresholds || DEFAULTS.thresholds
  };
  const sum = o => Object.values(o).reduce((a, b) => a + Number(b), 0);
  if (Object.keys(cfg.weights).length !== 7 || Object.values(cfg.weights).some(v => !Number.isFinite(Number(v)) || Number(v) < 0) || Math.abs(sum(cfg.weights) - 1) > .001) throw new Error('穿透因子权重必须为 7 个非负值且合计为 1');
  if (Object.keys(cfg.lossWeights).length !== 4 || Object.values(cfg.lossWeights).some(v => !Number.isFinite(Number(v)) || Number(v) < 0) || Math.abs(sum(cfg.lossWeights) - 1) > .001) throw new Error('损失因子权重必须为 4 个非负值且合计为 1');
  if (!Number.isFinite(Number(cfg.alpha)) || Number(cfg.alpha) < 0 || Number(cfg.alpha) > 1) throw new Error('α 必须在 0 到 1 之间');
  if (!Array.isArray(cfg.thresholds) || cfg.thresholds.length !== 4 || cfg.thresholds.some((v, i, a) => !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 1 || (i && Number(v) <= Number(a[i - 1])))) throw new Error('风险阈值必须是 0 到 1 之间严格递增的四个数');
  return cfg;
}

function evaluatePath(source, target, pathNodes, pathEdges, cfg) {
  const factors = { C: 0, N: 0, P: 0, R: 0, E: 0, B: 0, I: 0 };
  for (const edge of pathEdges) for (const key of Object.keys(factors)) factors[key] += Number(edge.factors[key] ?? 0);
  for (const key of Object.keys(factors)) factors[key] /= pathEdges.length;
  const w = cfg.weights;
  const score = w.C * factors.C + w.N * factors.N + w.P * factors.P + w.R * factors.R + w.E * factors.E + w.B * factors.B - w.I * factors.I;
  const penetration = Math.max(0, Math.min(1, score + w.I));
  const probability = Math.min(1, Number(source.probability || .3) * (1 + Number(cfg.alpha) * penetration));
  const lossWeights = cfg.lossWeights;
  const loss = Math.min(1, lossWeights.Av * Number(target.value || 0) + lossWeights.K * Number(target.importance || 0) + lossWeights.D * Number(target.sensitivity || 0) + lossWeights.Ic * Number(target.impact ?? target.availability ?? 0));
  const riskValue = probability * loss;
  return { source, target, pathNodes: pathNodes.map(n => n.id), pathEdges: pathEdges.map(e => e.id), factors, score, penetration, probability, loss, riskValue, level: level(riskValue, cfg.thresholds), valid: true };
}

function findPaths(nodes, edges, cfg, maxDepth = 7) {
  const byId = new Map(nodes.map(n => [ n.id, n ]));
  const outgoing = new Map();
  const at = Date.now();
  for (const edge of edges.filter(e => e.active && (!e.valid_from || Date.parse(e.valid_from) <= at) && (!e.valid_to || Date.parse(e.valid_to) >= at))) {
    if (!outgoing.has(edge.from_id)) outgoing.set(edge.from_id, []);
    outgoing.get(edge.from_id).push(edge);
  }
  const targets = new Set(nodes.filter(n => n.layer === 'tenant' && [ 'database', 'business', 'vm', 'container', 'application' ].includes(n.kind)).map(n => n.id));
  const results = [];
  const walk = (source, current, pathNodes, pathEdges, seen) => {
    if (pathEdges.length && targets.has(current.id) && current.id !== source.id) results.push(evaluatePath(source, current, pathNodes, pathEdges, cfg));
    if (pathEdges.length >= maxDepth) return;
    for (const edge of outgoing.get(current.id) || []) {
      if (seen.has(edge.to_id)) continue;
      const next = byId.get(edge.to_id);
      if (!next) continue;
      walk(source, next, pathNodes.concat(next), pathEdges.concat(edge), new Set([ ...seen, next.id ]));
    }
  };
  for (const source of nodes.filter(n => n.risk_source)) walk(source, source, [ source ], [], new Set([ source.id ]));
  return results;
}

module.exports = { DEFAULTS, level, mergeConfig, evaluatePath, findPaths };
