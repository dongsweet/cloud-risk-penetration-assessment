const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReport } = require('../app/lib/report');

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
