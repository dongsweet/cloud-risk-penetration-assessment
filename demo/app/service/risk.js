'use strict';

const Service = require('egg').Service;
const engine = require('../lib/risk-engine');
const crypto = require('crypto');

class RiskService extends Service {
  calculate(projectId, options = {}) {
    const db = this.service.db.db;
    const project = db.prepare('SELECT risk_config_json FROM projects WHERE id=?').get(projectId);
    if (!project) throw new Error('评估项目不存在');
    const stored = JSON.parse(project.risk_config_json || '{}');
    const cfg = engine.mergeConfig(stored, options);
    const found = engine.findPaths(this.service.db.nodes(projectId), this.service.db.edges(projectId), cfg);
    db.prepare('DELETE FROM risks WHERE project_id=?').run(projectId);
    const insert = db.prepare('INSERT INTO risks (id,project_id,source_id,target_id,path_json,valid,score,penetration,probability,loss,risk_value,level,factors_json,config_json,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const now = this.service.db.now();
    const tx = db.transaction(items => {
      db.prepare('UPDATE projects SET risk_config_json=?,updated_at=? WHERE id=?').run(JSON.stringify(cfg), now, projectId);
      items.forEach(r => {
        const riskId = `RISK-${crypto.createHash('sha1').update(`${projectId}:${r.source.id}:${r.target.id}:${r.pathEdges.join(',')}`).digest('hex').slice(0, 14)}`;
        insert.run(riskId, projectId, r.source.id, r.target.id, JSON.stringify({ nodes: r.pathNodes, edges: r.pathEdges }), 1, r.score, r.penetration, r.probability, r.loss, r.riskValue, r.level, JSON.stringify(r.factors), JSON.stringify(cfg), `${r.source.riskName || '风险源'}沿 ${r.pathNodes.join(' → ')} 穿透至 ${r.target.name}`, now);
      });
    });
    tx(found);
    this.service.db.audit(projectId, 'calculate', `生成 ${found.length} 条有效穿透路径`, 'system');
    return { config: cfg, count: found.length, risks: this.service.db.risks(projectId) };
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
