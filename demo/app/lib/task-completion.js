'use strict';

function normalizeTaskCompletion(input = {}) {
  const completionNote = String(input.completionNote || '').trim();
  const verificationNote = String(input.verificationNote || '').trim();
  const evidenceReference = String(input.evidenceReference || '').trim().slice(0, 500);
  if (completionNote.length < 8) throw new Error('请填写至少 8 个字符的整改措施和处理结果');
  if (verificationNote.length < 8) throw new Error('请填写至少 8 个字符的验证方法和验证结果');
  return {
    completionNote: completionNote.slice(0, 2000),
    verificationNote: verificationNote.slice(0, 2000),
    evidenceReference
  };
}

module.exports = { normalizeTaskCompletion };

