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
    risk_id: text(item?.risk_id, '', 100),
    priority: Number.isFinite(Number(item?.priority)) ? Number(item.priority) : null,
    risk_value: Number.isFinite(Number(item?.risk_value)) ? Number(item.risk_value) : null,
    title: text(item?.title || item?.name, '未命名发现', 200),
    severity: text(item?.severity || item?.level, '待确认', 40),
    description: text(item?.description || item?.detail, '', 2000),
    path: text(item?.path, '', 1000),
    evidence: list(item?.evidence, 8, 300),
    recommendation: text(item?.recommendation || item?.action, '', 1500)
  })).slice(0, 50) : [];
  const recommendations = Array.isArray(value.recommendations) ? value.recommendations.map(item => ({
    risk_id: text(item?.risk_id, '', 100),
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

function buildReportInputs(snapshot) {
  const evidence = Array.isArray(snapshot.evidence) ? snapshot.evidence : [];
  const followups = Array.isArray(snapshot.followups) ? snapshot.followups : [];
  const risks = (Array.isArray(snapshot.risks) ? snapshot.risks : [])
    .slice()
    .sort((a, b) => Number(a.priority || 5) - Number(b.priority || 5) || Number(b.risk_value || 0) - Number(a.risk_value || 0))
    .slice(0, 8);
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
  const project = snapshot.project || {};
  const activeFollowups = followups.filter(item => item.status === 'open');

  const evidenceInput = {
    project: { name: project.name || '', scope: project.scope || '' },
    counts: {
      evidence: evidence.length,
      extracted: evidence.filter(item => item.status === 'extracted').length,
      pending: evidence.filter(item => item.status !== 'extracted').length,
      nodes: snapshot.counts?.nodes ?? 0,
      edges: snapshot.counts?.edges ?? 0,
      risks: snapshot.counts?.risks ?? 0,
      openFollowups: activeFollowups.length
    },
    evidence: evidence.slice(0, 50).map(item => ({
      filename: item.filename,
      type: item.type,
      status: item.status,
      confidence: item.confidence,
      error: item.error || ''
    })),
    openQuestions: activeFollowups.slice(0, 20).map(item => ({
      title: item.title,
      question: item.question
    }))
  };

  const selectedRisks = risks.map(risk => ({
    risk_id: risk.id,
    level: risk.level,
    priority: risk.priority,
    source_id: risk.source_id,
    target_id: risk.target_id,
    path: risk.path?.nodes || [],
    risk_value: risk.risk_value,
    reason: risk.reason,
    recommendation: risk.recommendation,
    evidence: (risk.evidenceChain || []).map(item => item.filename).filter(Boolean)
  }));

  const riskInput = {
    project: { name: project.name || '', scope: project.scope || '' },
    ruleSummary: snapshot.summary || {},
    selectedRiskFacts: selectedRisks
  };

  return {
    evidenceInput,
    riskInput,
    selectedRisks,
    taskInput: {
      project: { name: project.name || '', scope: project.scope || '' },
      findings: [],
      existingTasks: tasks.slice(0, 30).map(item => ({
        risk_id: item.risk_id,
        title: item.title,
        owner: item.owner,
        due_date: item.due_date,
        priority: item.priority,
        status: item.status,
        recommendation: item.recommendation
      }))
    }
  };
}

function normalizeEvidenceStage(value, snapshot) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('证据评估步骤未返回 JSON 对象');
  const assessment = value.evidence_assessment || {};
  const evidence = Array.isArray(snapshot.evidence) ? snapshot.evidence : [];
  return {
    evidence_assessment: {
      total: evidence.length,
      extracted: evidence.filter(item => item.status === 'extracted').length,
      pending: evidence.filter(item => item.status !== 'extracted').length,
      quality: text(assessment.quality || value.quality, '', 1000),
      gaps: list(assessment.gaps || value.gaps, 30, 500)
    },
    limitations: list(value.limitations, 30, 800)
  };
}

function normalizeRiskStage(value, selectedRisks) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('风险分析步骤未返回 JSON 对象');
  const known = new Map(selectedRisks.map(risk => [ risk.risk_id, risk ]));
  const items = Array.isArray(value.findings) ? value.findings : [];
  const findings = [];
  const seen = new Set();
  for (const item of items) {
    const riskId = text(item?.risk_id, '', 100);
    const risk = known.get(riskId);
    if (!risk) throw new Error('风险分析步骤引用了未提供的风险编号');
    if (seen.has(riskId)) continue;
    seen.add(riskId);
    findings.push({
      risk_id: risk.risk_id,
      priority: Number(risk.priority || 5),
      risk_value: Number(risk.risk_value || 0),
      title: text(item?.title, `${risk.level}风险：${risk.source_id} → ${risk.target_id}`, 200),
      severity: risk.level,
      description: text(item?.description, risk.reason, 2000),
      path: (risk.path || []).join(' → '),
      evidence: risk.evidence.slice(0, 8),
      recommendation: text(item?.recommendation, risk.recommendation, 1500)
    });
  }
  if (!findings.length && selectedRisks.length) throw new Error('风险分析步骤没有输出可映射到规则风险的发现');
  return {
    executive_summary: text(value.executive_summary || value.summary, '', 4000),
    overall_conclusion: text(value.overall_conclusion || value.conclusion, '', 4000),
    findings
  };
}

function normalizeRecommendationStage(value, findings, snapshot) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('整改建议步骤未返回 JSON 对象');
  const findingById = new Map(findings.map(item => [ item.risk_id, item ]));
  const riskById = new Map((snapshot.risks || []).map(item => [ item.id, item ]));
  const taskByRisk = new Map((snapshot.tasks || []).filter(item => item.risk_id).map(item => [ item.risk_id, item ]));
  const supplied = Array.isArray(value.recommendations) ? value.recommendations : [];
  const suppliedByRisk = new Map();
  for (const item of supplied) {
    const riskId = text(item?.risk_id, '', 100);
    if (!findingById.has(riskId)) throw new Error('整改建议步骤引用了未提供的风险编号');
    suppliedByRisk.set(riskId, item);
  }
  const recommendations = findings.map(finding => {
    const item = suppliedByRisk.get(finding.risk_id) || {};
    const risk = riskById.get(finding.risk_id);
    const task = taskByRisk.get(finding.risk_id);
    return {
      risk_id: finding.risk_id,
      priority: `P${Number(risk?.priority || finding.priority || 5)}`,
      action: text(item.action, task?.recommendation || risk?.recommendation || finding.recommendation, 1000),
      owner: text(task?.owner, '待指定', 100),
      deadline: text(task?.due_date, '待指定', 80),
      basis: text(item.basis, `${finding.risk_id}：${finding.path}`, 1000)
    };
  }).filter(item => item.action);
  if (!recommendations.length && findings.length) throw new Error('整改建议步骤未生成可用建议');
  return {
    recommendations,
    next_steps: list(value.next_steps, 30, 800)
  };
}

function assembleReport(snapshot, evidenceStage, riskStage, recommendationStage, model, generatedAt = new Date().toISOString()) {
  const project = snapshot.project || {};
  return {
    ...normalizeReport({
      title: `云计算跨层风险穿透评估报告——${project.name || '未命名项目'}`,
      executive_summary: riskStage.executive_summary,
      assessment_scope: project.scope || '待填写评估范围',
      methodology: '系统先对已校验的材料和风险记录进行结构化分析，再由规则引擎确定路径、数值和等级；模型负责生成文字说明与整改建议。公式：S=w1C+w2N+w3P+w4R+w5E+w6B-w7I，Tp=S+w7，Pt=min(1,Pp×(1+αTp))，Lt=λ1Av+λ2K+λ3D+λ4Ic，Rt=Pt×Lt。',
      overall_conclusion: riskStage.overall_conclusion,
      findings: riskStage.findings,
      recommendations: recommendationStage.recommendations,
      evidence_assessment: evidenceStage.evidence_assessment,
      limitations: evidenceStage.limitations,
      next_steps: recommendationStage.next_steps
    }),
    model,
    generatedAt
  };
}

module.exports = {
  normalizeReport,
  buildReportInputs,
  normalizeEvidenceStage,
  normalizeRiskStage,
  normalizeRecommendationStage,
  assembleReport
};
