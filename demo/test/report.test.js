const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReport, buildReportInputs, normalizeRiskStage, normalizeEvidenceStage, normalizeRecommendationStage, assembleReport } = require('../app/lib/report');

test('report normalization keeps structured findings and bounds list sizes', () => {
  const report = normalizeReport({
    title: '评估报告',
    executive_summary: '发现一项需要复核的跨层风险。',
    findings: [ { title: '权限路径', severity: '高', description: '存在有效路径', evidence: [ '权限日志' ], recommendation: '收敛权限' } ],
    recommendations: [ { priority: 'P1', action: '复核高风险路径', owner: '平台组' } ],
    evidence_assessment: { total: 3, extracted: 2, pending: 1, gaps: [ '缺少变更记录' ] },
    limitations: [ '部分证据待补全' ]
  });
  assert.equal(report.findings[0].title, '权限路径');
  assert.equal(report.recommendations[0].owner, '平台组');
  assert.equal(report.evidence_assessment.pending, 1);
  assert.deepEqual(report.limitations, [ '部分证据待补全' ]);
});

test('report normalization rejects a response without summary or conclusion', () => {
  assert.throws(() => normalizeReport({ findings: [] }), /摘要或结论/);
});

test('report stages keep risk facts and evidence counts server authoritative', () => {
  const snapshot = {
    project: { name: '演示项目', scope: '政务云平台' },
    summary: { total: 1 },
    counts: { evidence: 1, nodes: 2, edges: 1, risks: 1 },
    risks: [ { id: 'R1', level: '高', priority: 1, risk_value: .82, source_id: 'U01', target_id: 'DB-A', path: { nodes: [ 'U01', 'DB-A' ] }, reason: '权限关系形成跨层路径', recommendation: '收敛权限', evidenceChain: [ { filename: '权限日志.json' } ] } ],
    evidence: [ { filename: '权限日志.json', type: 'json', status: 'extracted', confidence: .9 } ],
    followups: [],
    tasks: [ { risk_id: 'R1', owner: '安全管理员', due_date: '2026-11-10', priority: 1, recommendation: '收敛权限', status: 'open' } ]
  };
  const inputs = buildReportInputs(snapshot);
  const risk = normalizeRiskStage({ executive_summary: '摘要', overall_conclusion: '结论', findings: [ { risk_id: 'R1', title: '权限风险', description: '需要复核' } ] }, inputs.selectedRisks);
  const evidence = normalizeEvidenceStage({ evidence_assessment: { total: 999, extracted: 999, pending: 0, quality: '良好', gaps: [] } }, snapshot);
  const recommendations = normalizeRecommendationStage({ recommendations: [ { risk_id: 'R1', action: '收敛权限', basis: '已有风险路径' } ], next_steps: [ '补充复核记录' ] }, risk.findings, snapshot);
  const report = assembleReport(snapshot, evidence, risk, recommendations, 'demo-model');
  assert.equal(report.findings[0].risk_id, 'R1');
  assert.equal(report.findings[0].risk_value, .82);
  assert.equal(report.evidence_assessment.total, 1);
  assert.equal(report.recommendations[0].owner, '安全管理员');
});

test('risk stage rejects a model risk id that was not supplied by rules', () => {
  assert.throws(() => normalizeRiskStage({ findings: [ { risk_id: 'R-UNKNOWN' } ] }, [ { risk_id: 'R1', level: '高', priority: 1, risk_value: .8, source_id: 'U01', target_id: 'DB-A', path: [ 'U01', 'DB-A' ], reason: '', recommendation: '', evidence: [] } ]), /未提供的风险编号/);
});
