'use strict';

function text(value, fallback = '', limit = 4000) {
  const result = String(value ?? fallback).trim();
  return result.slice(0, limit);
}

function list(value, limit = 20, itemLimit = 1000) {
  if (!Array.isArray(value)) return [];
  return value.map(item => text(item, '', itemLimit)).filter(Boolean).slice(0, limit);
}

function normalizeReport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模型报告必须返回 JSON 对象');
  const executiveSummary = text(value.executive_summary || value.summary);
  const conclusion = text(value.overall_conclusion || value.conclusion);
  if (!executiveSummary && !conclusion) throw new Error('模型报告缺少评估摘要或结论');
  const findings = Array.isArray(value.findings) ? value.findings.map(item => ({
    title: text(item?.title || item?.name, '未命名发现', 200),
    severity: text(item?.severity || item?.level, '待确认', 40),
    description: text(item?.description || item?.detail, '', 2000),
    path: text(item?.path, '', 1000),
    evidence: list(item?.evidence, 8, 300),
    recommendation: text(item?.recommendation || item?.action, '', 1500)
  })).slice(0, 50) : [];
  const recommendations = Array.isArray(value.recommendations) ? value.recommendations.map(item => ({
    priority: text(item?.priority, '一般', 30),
    action: text(item?.action || item?.title, '', 1000),
    owner: text(item?.owner, '待指定', 100),
    deadline: text(item?.deadline, '待指定', 80),
    basis: text(item?.basis || item?.reason, '', 1000)
  })).filter(item => item.action).slice(0, 50) : [];
  const evidence = value.evidence_assessment || value.evidenceAssessment || {};
  return {
    title: text(value.title, '云计算跨层风险穿透评估报告', 200),
    executive_summary: executiveSummary,
    assessment_scope: text(value.assessment_scope || value.scope, '', 1000),
    methodology: text(value.methodology, '', 1500),
    overall_conclusion: conclusion,
    findings,
    recommendations,
    evidence_assessment: {
      total: Number.isFinite(Number(evidence.total)) ? Number(evidence.total) : null,
      extracted: Number.isFinite(Number(evidence.extracted)) ? Number(evidence.extracted) : null,
      pending: Number.isFinite(Number(evidence.pending)) ? Number(evidence.pending) : null,
      quality: text(evidence.quality, '', 1000),
      gaps: list(evidence.gaps, 30, 500)
    },
    limitations: list(value.limitations, 30, 800),
    next_steps: list(value.next_steps || value.nextSteps, 30, 800)
  };
}

module.exports = { normalizeReport };
