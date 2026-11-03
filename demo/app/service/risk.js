'use strict';

const Service = require('egg').Service;
const engine = require('../lib/risk-engine');
const crypto = require('crypto');

function riskId(projectId, risk) {
  return `RISK-${crypto.createHash('sha1').update(`${projectId}:${risk.source.id}:${risk.target.id}:${risk.pathEdges.join(',')}`).digest('hex').slice(0, 14)}`;
}

class RiskService extends Service {
  calculate(projectId, options = {}) {
    const db = this.service.db.db;
    const project = db.prepare('SELECT risk_config_json FROM projects WHERE id=?').get(projectId);
    if (!project) throw new Error('评估项目不存在');
    const stored = JSON.parse(project.risk_config_json || '{}');
    const cfg = engine.mergeConfig(stored, options);
    const analysis = engine.analyzePaths(this.service.db.nodes(projectId), this.service.db.edges(projectId), cfg);
    const found = analysis.risks;
    const insert = db.prepare(`INSERT INTO risks (id,project_id,source_id,target_id,path_json,valid,score,penetration,penetration_level,probability,loss,risk_value,level,priority,recommendation,review_required,review_reasons_json,evidence_chain_json,source_layer,target_layer,tenant,business,factors_json,config_json,reason,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const now = this.service.db.now();
    const levels = {};
    found.forEach(r => { levels[r.level] = (levels[r.level] || 0) + 1; });
    const summary = { calculatedAt: now, total: found.length, blockedCount: analysis.blockedCount, blockedEdgeCount: analysis.blockedEdgeCount, effectiveEdgeCount: analysis.effectiveEdgeCount, invalidEdgeCount: analysis.invalidEdgeCount, blockedEdges: analysis.blockedEdges, levels, openFollowups: db.prepare("SELECT COUNT(*) AS n FROM followups WHERE project_id=? AND status='open'").get(projectId).n };
    const tx = db.transaction(items => {
      db.prepare('UPDATE projects SET risk_config_json=?,risk_summary_json=?,status=?,updated_at=? WHERE id=?').run(JSON.stringify(cfg), JSON.stringify(summary), found.length ? 'in_review' : 'draft', now, projectId);
      db.prepare('DELETE FROM risks WHERE project_id=?').run(projectId);
      db.prepare('DELETE FROM remediation_tasks WHERE project_id=? AND risk_id IS NOT NULL').run(projectId);
      items.forEach(r => {
        const source = r.source || {};
        const target = r.target || {};
        const path = { nodes: r.pathNodes, edges: r.pathEdges };
        const evidenceChain = this.service.db.riskEvidenceChain(projectId, path);
        const id = riskId(projectId, r);
        const reason = `${source.riskName || '风险源'}沿 ${r.pathNodes.join(' → ')} 穿透至 ${target.name || target.id}`;
        insert.run(id, projectId, source.id, target.id, JSON.stringify(path), 1, r.score, r.penetration, r.penetrationLevel, r.probability, r.loss, r.riskValue, r.level, r.priority, r.recommendation, r.reviewRequired ? 1 : 0, JSON.stringify(r.reviewReasons), JSON.stringify(evidenceChain), source.layer || '', target.layer || '', target.tenant || '', target.name || target.id, JSON.stringify(r.factors), JSON.stringify(cfg), reason, now);
        if (r.priority <= 3) {
          const owner = r.factors.P >= .7 ? '安全管理员' : r.factors.N >= .7 ? '网络管理员' : '评估人员';
          const due = new Date(Date.now() + (r.priority === 1 ? 3 : r.priority === 2 ? 7 : 14) * 86400000).toISOString().slice(0, 10);
          db.prepare('INSERT INTO remediation_tasks (id,project_id,risk_id,title,owner,status,due_date,priority,recommendation,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(`TASK-${id}`, projectId, id, `[P${r.priority}] ${target.name || target.id} 风险处置`, owner, 'open', due, r.priority, r.recommendation, now);
        }
      });
    });
    tx(found);
    this.service.db.audit(projectId, 'calculate', `生成 ${found.length} 条有效穿透路径，阻断候选 ${analysis.blockedCount} 条`, 'system');
    return { config: cfg, count: found.length, summary, risks: this.service.db.risks(projectId) };
  }

  getConfig(projectId = 'PRJ-DEMO-001') {
    const project = this.service.db.project(projectId);
    let stored = {};
    try {
      stored = JSON.parse(project?.risk_config_json || '{}');
    } catch (_) {
      stored = {};
    }
    return engine.mergeConfig(stored);
  }
}

module.exports = RiskService;
