'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTaskCompletion } = require('../app/lib/task-completion');

test('task completion requires both remediation and verification notes', () => {
  assert.throws(() => normalizeTaskCompletion({ completionNote: '已完成配置整改操作' }), /验证方法和验证结果/);
  assert.throws(() => normalizeTaskCompletion({ completionNote: '已修复', verificationNote: '复核通过' }), /整改措施和处理结果/);
});

test('task completion trims and bounds submitted records', () => {
  const result = normalizeTaskCompletion({
    completionNote: '  已撤销临时高权限账号并复核授权清单  ',
    verificationNote: '  查询审计日志确认该账号已无有效授权  ',
    evidenceReference: '  ACL-2026-1103  '
  });
  assert.equal(result.completionNote, '已撤销临时高权限账号并复核授权清单');
  assert.equal(result.verificationNote, '查询审计日志确认该账号已无有效授权');
  assert.equal(result.evidenceReference, 'ACL-2026-1103');
  assert.equal(normalizeTaskCompletion({ completionNote: '完成了配置整改操作', verificationNote: '重新核对授权清单无有效权限' }).evidenceReference, '');
});

