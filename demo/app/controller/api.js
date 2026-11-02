'use strict';

const Controller = require('egg').Controller;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mammoth = require('mammoth');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const evidenceTools = require('../lib/evidence');
const { cookie } = require('../middleware/authorize');

function id(prefix) { return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`; }
function body(ctx) {
  if (ctx.request.body && typeof ctx.request.body === 'object') return ctx.request.body;
  return {};
}
function ok(ctx, data) { ctx.body = { ok: true, data }; }
function json(value) { try { return JSON.parse(value); } catch (_) { return {}; } }

class ApiController extends Controller {
  async health() {
    const db = this.service.db.db;
    const config = this.service.db.systemConfig();
    this.ctx.body = { ok: true, service: 'cloud-risk-penetration-demo', time: new Date().toISOString(), database: !!db, llmConfigured: Boolean(config.llmBaseUrl && process.env.LLM_API_KEY && config.llmModel) };
  }

  async dashboard() {
    const db = this.service.db.db;
    const requestedId = String(this.ctx.query.projectId || '').trim();
    const project = requestedId ? this.service.db.project(requestedId) : this.service.db.listProjects()[0] ? this.service.db.project(this.service.db.listProjects()[0].id) : null;
    const empty = { project: null, nodes: 0, edges: 0, evidence: 0, risks: 0, highRisks: 0, openFollowups: 0, openTasks: 0, hasSecurityAdmin: Boolean(db.prepare("SELECT 1 FROM app_users u JOIN app_user_roles r ON r.user_id=u.id WHERE u.status='ACTIVE' AND r.role_code='SECURITY_ADMIN' LIMIT 1").get()), llmConfigured: Boolean(this.service.db.systemConfig().llmBaseUrl && process.env.LLM_API_KEY && this.service.db.systemConfig().llmModel), riskConfig: null, modelName: this.service.db.systemConfig().llmModel || '' };
    if (!project) { ok(this.ctx, empty); return; }
    ok(this.ctx, {
      project,
      nodes: db.prepare('SELECT COUNT(*) AS n FROM nodes WHERE project_id=?').get(project.id).n,
      edges: db.prepare('SELECT COUNT(*) AS n FROM edges WHERE project_id=?').get(project.id).n,
      evidence: db.prepare('SELECT COUNT(*) AS n FROM evidence WHERE project_id=?').get(project.id).n,
      risks: db.prepare('SELECT COUNT(*) AS n FROM risks WHERE project_id=?').get(project.id).n,
      highRisks: db.prepare("SELECT COUNT(*) AS n FROM risks WHERE project_id=? AND level IN ('高','很高')").get(project.id).n,
      openFollowups: db.prepare("SELECT COUNT(*) AS n FROM followups WHERE project_id=? AND status='open'").get(project.id).n,
      openTasks: db.prepare("SELECT COUNT(*) AS n FROM remediation_tasks WHERE project_id=? AND status='open'").get(project.id).n,
      hasSecurityAdmin: empty.hasSecurityAdmin,
      llmConfigured: empty.llmConfigured,
      riskConfig: this.service.risk.getConfig(project.id),
      modelName: empty.modelName
    });
  }

  async authStatus() {
    ok(this.ctx, { initialized: this.service.db.db.prepare('SELECT COUNT(*) AS n FROM app_users').get().n > 0 });
  }

  async authSetup() {
    if (this.service.db.db.prepare('SELECT COUNT(*) AS n FROM app_users').get().n) this.ctx.throw(409, '系统已完成初始化');
    const input = body(this.ctx);
    const user = await this.service.auth.createUser({ username: input.username, displayName: input.displayName, password: input.password, roles: [ 'SYSTEM_ADMIN' ], scopes: [] }, 'system', { bootstrap: true });
    const result = await this.service.auth.login(input.username, input.password, this.ctx.ip, this.ctx.get('user-agent'));
    cookie(this.ctx, 'risk_session', result.token, { maxAge: 8 * 60 * 60 * 1000 });
    cookie(this.ctx, 'risk_csrf', result.csrf, { httpOnly: false, maxAge: 8 * 60 * 60 * 1000 });
    this.ctx.status = 201;
    ok(this.ctx, { user, csrfToken: result.csrf, roles: this.service.auth.labels() });
  }

  async login() {
    try {
      const input = body(this.ctx);
      const result = await this.service.auth.login(input.username, input.password, this.ctx.ip, this.ctx.get('user-agent'));
      this.ctx.app.loginAttempts?.delete(this.ctx.ip || 'unknown');
      const config = this.service.db.systemConfig();
      cookie(this.ctx, 'risk_session', result.token, { maxAge: config.sessionAbsoluteHours * 60 * 60 * 1000 });
      cookie(this.ctx, 'risk_csrf', result.csrf, { httpOnly: false, maxAge: config.sessionAbsoluteHours * 60 * 60 * 1000 });
      ok(this.ctx, { user: result.user, csrfToken: result.csrf, roles: this.service.auth.labels() });
    } catch (err) { this.ctx.status = err.status || 401; this.ctx.body = { ok: false, error: err.message, code: err.code }; }
  }

  async authMe() {
    ok(this.ctx, { user: this.ctx.state.user, csrfToken: this.ctx.cookies.get('risk_csrf', { signed: false }) || '', roles: this.service.auth.labels(), scopes: this.service.auth.scopeLabels() });
  }

  async logout() {
    this.service.auth.logout(this.ctx.state.principal);
    cookie(this.ctx, 'risk_session', '', { maxAge: -1 });
    cookie(this.ctx, 'risk_csrf', '', { httpOnly: false, maxAge: -1 });
    ok(this.ctx, { loggedOut: true });
  }

  async changePassword() {
    try {
      const input = body(this.ctx);
      await this.service.auth.changePassword(this.ctx.state.user.id, input.oldPassword, input.password);
      cookie(this.ctx, 'risk_session', '', { maxAge: -1 });
      cookie(this.ctx, 'risk_csrf', '', { httpOnly: false, maxAge: -1 });
      ok(this.ctx, { changed: true, loginRequired: true });
    } catch (err) { this.ctx.status = err.status || 400; this.ctx.body = { ok: false, error: err.message }; }
  }

  async users() { ok(this.ctx, { users: this.service.auth.listUsers(), roles: this.service.auth.labels(), scopes: this.service.auth.scopeLabels() }); }
  async createUser() {
    try { this.ctx.status = 201; ok(this.ctx, { user: await this.service.auth.createUser(body(this.ctx), this.ctx.state.user.id) }); }
    catch (err) { this.ctx.status = err.status || 400; this.ctx.body = { ok: false, error: err.message }; }
  }
  async updateUser() {
    try { ok(this.ctx, { user: this.service.auth.updateUser(this.ctx.params.id, body(this.ctx), this.ctx.state.user.id) }); }
    catch (err) { this.ctx.status = err.status || 400; this.ctx.body = { ok: false, error: err.message }; }
  }
  async resetUserPassword() {
    try { await this.service.auth.resetPassword(this.ctx.params.id, body(this.ctx).password, this.ctx.state.user.id); ok(this.ctx, { reset: true, mustChangePassword: true }); }
    catch (err) { this.ctx.status = err.status || 400; this.ctx.body = { ok: false, error: err.message }; }
  }

  async systemConfig() {
    if (this.ctx.method === 'GET') { ok(this.ctx, this.service.db.systemConfig()); return; }
    try {
      const input = body(this.ctx);
      if (input.llmBaseUrl) {
        const url = new URL(String(input.llmBaseUrl));
        if (![ 'http:', 'https:' ].includes(url.protocol) || url.username || url.password || url.search || url.hash) this.ctx.throw(400, '模型服务地址仅支持 HTTP(S) 基地址');
      }
      const saved = this.service.db.saveSystemConfig(input, this.ctx.state.user.username);
      this.service.auth.event('SYSTEM_CONFIG_UPDATED', this.ctx.state.user.id, null, { fields: Object.keys(input) }, this.ctx.ip);
      ok(this.ctx, saved);
    } catch (err) { if (err.status) throw err; this.ctx.throw(400, err.message); }
  }

  async authEvents() {
    const items = this.service.db.db.prepare('SELECT event_id,actor_user_id,target_user_id,event_type,details_json,source_address,created_at FROM auth_events ORDER BY created_at DESC LIMIT 200').all().map(row => ({ ...row, details: json(row.details_json), actor: row.actor_user_id ? this.service.auth.getUser(row.actor_user_id)?.username || '已删除账号' : '系统' }));
    ok(this.ctx, items);
  }

  async graphTemplate() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = '云盾 RiskLab';
    const addSheet = (name, columns) => {
      const sheet = workbook.addWorksheet(name);
      sheet.columns = columns.map(header => ({ header, key: header, width: Math.max(14, header.length * 2) }));
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2864E8' } };
      sheet.views = [ { state: 'frozen', ySplit: 1 } ];
      return sheet;
    };
    addSheet('资产节点', [ 'asset_id', 'asset_name', 'asset_type', 'layer', 'tenant', 'pool', 'value', 'importance', 'sensitivity', 'availability', 'impact', 'risk_name', 'probability', 'source', 'confidence', 'description' ]);
    addSheet('关系边', [ 'edge_id', 'source_asset_id', 'target_asset_id', 'relation_type', 'active', 'source', 'confidence', 'valid_from', 'valid_to', 'C', 'N', 'P', 'R', 'E', 'B', 'I' ]);
    addSheet('风险源', [ 'node_id', 'risk_name', 'probability', 'source', 'confidence' ]);
    const note = workbook.addWorksheet('填写说明');
    note.columns = [ { header: '说明', key: 'note', width: 100 } ];
    [ '模板不含示例资产，请直接填写本次评估材料中的真实数据。', '资产 asset_type 可填 host/virtualization/vm/container/application/database/business/account/resource_pool/security_control/storage/network/other。', '资产 layer 只能填 platform、tenant 或 control；关系类型使用系统允许的中文枚举；active 可填 有效/失效 或 true/false。', '置信度和计算因子填写 0 到 1；导入前服务端会校验整本工作簿，错误行会整体拒绝，不会生成部分图谱。', '关系边引用的 source_asset_id 和 target_asset_id 必须存在于资产节点工作表或当前项目图谱中。' ].forEach(text => note.addRow([ text ]));
    this.ctx.type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    this.ctx.set('Content-Disposition', 'attachment; filename="cloud-risk-graph-template.xlsx"');
    this.ctx.body = await workbook.xlsx.writeBuffer();
  }

  async projects() { ok(this.ctx, this.service.db.listProjects()); }

  async createProject() {
    const input = body(this.ctx);
    const name = String(input.name || '').trim().slice(0, 120);
    if (!name) this.ctx.throw(400, '项目名称不能为空');
    const scope = String(input.scope || '待填写评估范围').trim().slice(0, 500);
    const now = this.service.db.now();
    const project = { id: id('PRJ'), name, scope, status: 'draft', created_at: now, updated_at: now };
    this.service.db.db.prepare('INSERT INTO projects (id,name,scope,status,created_at,updated_at) VALUES (@id,@name,@scope,@status,@created_at,@updated_at)').run(project);
    this.service.db.audit(project.id, 'create_project', project.name, this.ctx.state.user?.username || 'system');
    this.ctx.status = 201;
    ok(this.ctx, project);
  }

  async project() {
    const project = this.service.db.project(this.ctx.params.id);
    if (!project) this.ctx.throw(404, '评估项目不存在');
    ok(this.ctx, { project, nodes: this.service.db.nodes(project.id), edges: this.service.db.edges(project.id), evidence: this.service.db.evidence(project.id), risks: this.service.db.risks(project.id), followups: this.service.db.followups(project.id), reviews: this.service.db.reviews(project.id) });
  }

  async graph() { ok(this.ctx, { nodes: this.service.db.nodes(this.ctx.params.projectId), edges: this.service.db.edges(this.ctx.params.projectId) }); }
  async evidence() { ok(this.ctx, this.service.db.evidence(this.ctx.params.projectId)); }
  async risks() { ok(this.ctx, this.service.db.risks(this.ctx.params.projectId)); }
  async reviews() { ok(this.ctx, this.service.db.reviews(this.ctx.params.projectId)); }
  async followups() { ok(this.ctx, this.service.db.followups(this.ctx.params.projectId)); }
  async tasks() { ok(this.ctx, this.service.db.db.prepare('SELECT * FROM remediation_tasks WHERE project_id=? ORDER BY status, due_date').all(this.ctx.params.projectId)); }
  async audit() { ok(this.ctx, this.service.db.db.prepare('SELECT * FROM audit_logs WHERE project_id=? ORDER BY created_at DESC LIMIT 100').all(this.ctx.params.projectId)); }
  async updateTask() {
    const task = this.service.db.db.prepare('SELECT * FROM remediation_tasks WHERE id=?').get(this.ctx.params.taskId);
    if (!task) this.ctx.throw(404, '整改任务不存在');
    const input = body(this.ctx);
    const status = [ 'open', 'in_progress', 'done', 'blocked' ].includes(input.status) ? input.status : task.status;
    this.service.db.db.prepare('UPDATE remediation_tasks SET status=? WHERE id=?').run(status, task.id);
    this.service.db.audit(task.project_id, 'task_status', `${task.id} / ${status}`);
    ok(this.ctx, this.service.db.db.prepare('SELECT * FROM remediation_tasks WHERE id=?').get(task.id));
  }

  async uploadEvidence() {
    const ctx = this.ctx;
    const projectId = ctx.params.projectId;
    const file = (ctx.request.files || [])[0];
    if (!file) ctx.throw(400, '请选择证据文件');
    const uploadDir = process.env.UPLOAD_DIR || path.join(this.app.baseDir, 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    const safeName = `${Date.now()}-${path.basename(file.filename).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')}`;
    const target = path.join(uploadDir, safeName);
    fs.copyFileSync(file.filepath, target);
    const extension = path.extname(file.filename).slice(1).toLowerCase();
    if (extension === 'xlsx' && await evidenceTools.isGraphTemplate(target)) {
      const evidence = { id: id('EV'), project_id: projectId, filename: file.filename, type: extension, content: '', status: 'pending', extraction_json: '{}', source: `Excel 图谱模板导入：${file.filename}`, confidence: 0, created_at: this.service.db.now() };
      this.service.db.db.prepare('INSERT INTO evidence (id,project_id,filename,type,content,status,extraction_json,source,confidence,created_at) VALUES (@id,@project_id,@filename,@type,@content,@status,@extraction_json,@source,@confidence,@created_at)').run(evidence);
      try {
        const extraction = await evidenceTools.importExcel(target, `Excel 图谱模板导入：${file.filename}`);
        this.applyExtraction(projectId, evidence.id, extraction);
        this.service.db.db.prepare("UPDATE evidence SET status='extracted',extraction_json=?,confidence=?,error=NULL WHERE id=?").run(JSON.stringify(extraction), .9, evidence.id);
        evidence.status = 'extracted'; evidence.extraction_json = JSON.stringify(extraction); evidence.confidence = .9;
        this.service.db.audit(projectId, 'import_graph_excel', file.filename);
        return ok(ctx, { ...evidence, extraction });
      } catch (err) {
        this.service.db.db.prepare("UPDATE evidence SET status='rejected',error=? WHERE id=?").run(err.message, evidence.id);
        this.service.db.audit(projectId, 'import_graph_excel_failed', `${file.filename} / ${err.message}`);
        this.ctx.status = 422;
        return this.ctx.body = { ok: false, error: err.message, data: { status: 'pending', retryable: false } };
      }
    }
    let content = '';
    let readError = '';
    try {
      content = extension === 'xlsx'
        ? await evidenceTools.extractExcelText(target)
        : await this.readEvidence(target, file.filename);
    } catch (err) { readError = `文本提取失败：${err.message}`; }
    if (!String(content || '').trim() && !readError) readError = '未能从文件中提取文本，扫描版 PDF 或空白文件需要提供可检索文本版本';
    const evidence = { id: id('EV'), project_id: projectId, filename: file.filename, type: path.extname(file.filename).slice(1).toLowerCase() || 'unknown', content: String(content || '').slice(0, 100000), status: 'pending', extraction_json: '{}', source: `上传文件：${file.filename}`, confidence: 0, created_at: this.service.db.now() };
    this.service.db.db.prepare('INSERT INTO evidence (id,project_id,filename,type,content,status,extraction_json,source,confidence,created_at) VALUES (@id,@project_id,@filename,@type,@content,@status,@extraction_json,@source,@confidence,@created_at)').run(evidence);
    if (readError) this.service.db.db.prepare('UPDATE evidence SET error=? WHERE id=?').run(readError, evidence.id);
    this.service.db.audit(projectId, 'upload_evidence', file.filename);
    if ([ 'csv', 'json' ].includes(evidence.type) && !readError) {
      try {
        const extraction = evidenceTools.importStructured(evidence.content, evidence.type, evidence.source);
        this.applyExtraction(projectId, evidence.id, extraction);
        evidence.status = 'extracted';
        evidence.extraction_json = JSON.stringify(extraction);
        evidence.confidence = .9;
        evidence.extraction = extraction;
        this.service.db.db.prepare('UPDATE evidence SET status=?,extraction_json=?,confidence=? WHERE id=?').run(evidence.status, evidence.extraction_json, evidence.confidence, evidence.id);
      } catch (err) {
        evidence.error = `未匹配图谱字段，已保留为模型材料：${err.message}`;
        this.service.db.db.prepare('UPDATE evidence SET error=? WHERE id=?').run(evidence.error, evidence.id);
      }
    }
    ok(ctx, { ...evidence, extraction: evidence.extraction || {} });
  }

  async extractEvidence() {
    const { projectId, evidenceId } = this.ctx.params;
    const row = this.service.db.db.prepare('SELECT * FROM evidence WHERE id=? AND project_id=?').get(evidenceId, projectId);
    if (!row) this.ctx.throw(404, '证据不存在');
    if (!String(row.content || '').trim()) this.ctx.throw(422, row.error || '文件中没有可供模型分析的文本');
    try {
      const extraction = await this.service.llm.extract(row.content, row.filename);
      this.applyExtraction(projectId, evidenceId, extraction);
      const candidates = [ ...(extraction.assets || []), ...(extraction.relations || []), ...(extraction.risks || []) ];
      const confidence = candidates.length ? Math.min(...candidates.map(x => Number(x.confidence ?? .8))) : .8;
      this.service.db.db.prepare("UPDATE evidence SET status='extracted',extraction_json=?,confidence=?,error=NULL WHERE id=?").run(JSON.stringify(extraction), confidence, evidenceId);
      this.service.db.audit(projectId, 'extract_evidence', `${row.filename} / ${process.env.LLM_MODEL}`);
      ok(this.ctx, { status: 'extracted', extraction });
    } catch (err) {
      this.service.db.db.prepare("UPDATE evidence SET status='pending',error=? WHERE id=?").run(err.message, evidenceId);
      this.service.db.audit(projectId, 'extract_evidence_failed', `${row.filename} / ${err.message}`);
      this.ctx.status = 422;
      this.ctx.body = { ok: false, error: err.message, data: { status: 'pending', retryable: true } };
    }
  }

  async calculate() {
    const result = this.service.risk.calculate(this.ctx.params.projectId, body(this.ctx));
    ok(this.ctx, result);
  }

  async riskConfig() {
    const projectId = this.ctx.params.projectId;
    if (!this.service.db.project(projectId)) this.ctx.throw(404, '评估项目不存在');
    try {
      const config = require('../lib/risk-engine').mergeConfig({}, body(this.ctx));
      this.service.db.db.prepare('UPDATE projects SET risk_config_json=?,updated_at=? WHERE id=?').run(JSON.stringify(config), this.service.db.now(), projectId);
      this.service.db.audit(projectId, 'risk_config', '更新风险计算参数');
      ok(this.ctx, config);
    } catch (err) { this.ctx.throw(400, err.message); }
  }

  applyExtraction(projectId, evidenceId, extraction) {
    const db = this.service.db.db;
    const now = this.service.db.now();
    const lowConfidence = this.service.db.systemConfig().lowConfidenceThreshold;
    const upsertNode = db.prepare(`INSERT INTO nodes (id,project_id,name,kind,layer,tenant,pool,value,importance,sensitivity,availability,impact,risk_source,risk_name,probability,description,meta_json)
      VALUES (@id,@project_id,@name,@kind,@layer,@tenant,@pool,@value,@importance,@sensitivity,@availability,@impact,@risk_source,@risk_name,@probability,@description,@meta_json)
      ON CONFLICT(id) DO UPDATE SET
        value=CASE WHEN nodes.value=0 AND excluded.value>0 THEN excluded.value ELSE nodes.value END,
        importance=CASE WHEN nodes.importance=0 AND excluded.importance>0 THEN excluded.importance ELSE nodes.importance END,
        sensitivity=CASE WHEN nodes.sensitivity=0 AND excluded.sensitivity>0 THEN excluded.sensitivity ELSE nodes.sensitivity END,
        availability=CASE WHEN nodes.availability=0 AND excluded.availability>0 THEN excluded.availability ELSE nodes.availability END,
        impact=CASE WHEN nodes.impact=0 AND excluded.impact>0 THEN excluded.impact ELSE nodes.impact END`);
    const insertEdge = db.prepare(`INSERT INTO edges (id,project_id,from_id,to_id,relation,active,source,confidence,factors_json,valid_from,valid_to)
      VALUES (@id,@project_id,@from_id,@to_id,@relation,@active,@source,@confidence,@factors_json,@valid_from,@valid_to)
      ON CONFLICT(id) DO NOTHING`);
    const tx = db.transaction(() => {
      const extractedIds = new Set((extraction.assets || []).map(x => x.id));
      for (const item of extraction.relations || []) {
        const endpoints = db.prepare('SELECT id FROM nodes WHERE project_id=? AND id IN (?,?)').all(projectId, item.from, item.to).map(x => x.id);
        if ((!endpoints.includes(item.from) && !extractedIds.has(item.from)) || (!endpoints.includes(item.to) && !extractedIds.has(item.to))) throw new Error(`关系 ${item.from} → ${item.to} 引用了未登记资产，已保留待处理`);
      }
      for (const item of extraction.assets || []) {
        const valid = (v, fallback = 0) => { const n = Number(v ?? fallback); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback; };
        const current = db.prepare('SELECT * FROM nodes WHERE id=? AND project_id=?').get(item.id, projectId);
        const differs = current && ((item.name && current.name !== item.name) || (item.type && current.kind !== item.type) || (item.layer && current.layer !== item.layer) || [ 'value', 'importance', 'sensitivity', 'impact' ].some(k => item[k] !== undefined && Math.abs(Number(current[k] || 0) - Number(item[k])) > .01));
        if (differs) db.prepare('INSERT INTO followups (id,project_id,slot,title,question,status,created_at) VALUES (?,?,?,?,?,?,?)').run(id('FU'), projectId, `asset:${item.id}:conflict`, '资产证据冲突待确认', `证据 ${evidenceId} 对资产 ${item.id} 的属性与当前图谱不一致，请确认采用值并补充依据。`, 'open', now);
        upsertNode.run({ id: item.id, project_id: projectId, name: item.name || item.id, kind: item.type || 'other', layer: item.layer || 'tenant', tenant: item.tenant || '', pool: item.pool || '', value: valid(item.value), importance: valid(item.importance), sensitivity: valid(item.sensitivity), availability: valid(item.availability), impact: valid(item.impact), risk_source: 0, risk_name: '', probability: 0, description: item.description || '', meta_json: JSON.stringify({ source: item.source, confidence: item.confidence, evidenceId, extractedAt: extraction.extractedAt || now, reviewStatus: item.confidence < lowConfidence ? 'low_confidence_candidate' : 'candidate' }) });
        if (Number(item.confidence) < lowConfidence) db.prepare('INSERT INTO followups (id,project_id,slot,title,question,status,created_at) VALUES (?,?,?,?,?,?,?)').run(id('FU'), projectId, `asset:${item.id}:confidence`, '低置信度资产待确认', `资产 ${item.id} 的抽取置信度为 ${item.confidence}，请确认资产标识、层级和属性。`, 'open', now);
      }
      for (const item of extraction.relations || []) {
        const edgeId = item.id || `EDGE-${crypto.createHash('sha1').update(`${projectId}:${item.from}:${item.to}:${item.relation}`).digest('hex').slice(0, 12)}`;
        const current = db.prepare('SELECT * FROM edges WHERE id=? AND project_id=?').get(edgeId, projectId);
        if (current && !!current.active !== !!item.active) db.prepare('INSERT INTO followups (id,project_id,slot,title,question,status,created_at) VALUES (?,?,?,?,?,?,?)').run(id('FU'), projectId, `edge:${edgeId}:conflict`, '关系有效状态冲突待确认', `证据 ${evidenceId} 对关系 ${item.from} → ${item.to} 的有效状态与现有图谱不一致，请核实当前资源或权限状态。`, 'open', now);
        if (Number(item.confidence) < lowConfidence) db.prepare('INSERT INTO followups (id,project_id,slot,title,question,status,created_at) VALUES (?,?,?,?,?,?,?)').run(id('FU'), projectId, `edge:${edgeId}:confidence`, '低置信度关系待确认', `关系 ${item.from} → ${item.to} 的抽取置信度为 ${item.confidence}，请确认关系类型、方向和有效状态。`, 'open', now);
        insertEdge.run({ id: edgeId, project_id: projectId, from_id: item.from, to_id: item.to, relation: item.relation, active: item.active && Number(item.confidence) >= lowConfidence ? 1 : 0, source: item.source || `证据 ${evidenceId}`, confidence: Number(item.confidence || .75), factors_json: JSON.stringify(item.factors || {}), valid_from: item.valid_from || null, valid_to: item.valid_to || null });
      }
      for (const risk of extraction.risks || []) {
        const nodeId = risk.node_id || risk.asset_id || risk.assetId;
        if (nodeId) db.prepare('UPDATE nodes SET risk_source=1,risk_name=?,probability=? WHERE id=? AND project_id=?').run(risk.name, Number(risk.probability || .3), nodeId, projectId);
      }
      for (let i = 0; i < (extraction.questions || []).length; i++) {
        const question = typeof extraction.questions[i] === 'string' ? extraction.questions[i] : extraction.questions[i].question;
        if (!question) continue;
        db.prepare('INSERT INTO followups (id,project_id,slot,title,question,status,created_at) VALUES (?,?,?,?,?,?,?)').run(id('FU'), projectId, `evidence:${evidenceId}:question:${i + 1}`, '证据抽取待确认', question, 'open', now);
      }
    });
    tx();
  }

  async review() {
    const input = body(this.ctx);
    const risk = this.service.db.db.prepare('SELECT * FROM risks WHERE id=?').get(this.ctx.params.reviewId);
    if (!risk) this.ctx.throw(404, '风险项不存在');
    const field = input.field || 'risk_value';
    if (![ 'level', 'risk_value' ].includes(field)) this.ctx.throw(400, '不支持的复核字段');
    if (field === 'level' && ![ '很低', '低', '中', '高', '很高' ].includes(input.afterValue)) this.ctx.throw(400, '风险等级无效');
    if (field === 'risk_value' && (!Number.isFinite(Number(input.afterValue)) || Number(input.afterValue) < 0 || Number(input.afterValue) > 1)) this.ctx.throw(400, '风险值必须在 0 到 1 之间');
    const review = { id: id('REV'), project_id: risk.project_id, risk_id: risk.id, field, before_value: String(input.beforeValue ?? ''), after_value: String(input.afterValue ?? ''), reason: input.reason || '人工复核修订', reviewer: this.ctx.state.user.displayName, created_at: this.service.db.now() };
    this.service.db.db.prepare('INSERT INTO reviews (id,project_id,risk_id,field,before_value,after_value,reason,reviewer,created_at) VALUES (@id,@project_id,@risk_id,@field,@before_value,@after_value,@reason,@reviewer,@created_at)').run(review);
    if (field === 'level') this.service.db.db.prepare('UPDATE risks SET level=? WHERE id=?').run(input.afterValue, risk.id);
    if (field === 'risk_value') {
      const value = Number(input.afterValue);
      const thresholds = this.service.risk.getConfig(risk.project_id).thresholds;
      const level = require('../lib/risk-engine').level(value, thresholds);
      this.service.db.db.prepare('UPDATE risks SET risk_value=?,level=? WHERE id=?').run(value, level, risk.id);
    }
    this.service.db.audit(risk.project_id, 'review_writeback', `${risk.id} / ${review.field}`);
    ok(this.ctx, review);
  }

  async answerFollowup() {
    const input = body(this.ctx);
    const followup = this.service.db.db.prepare('SELECT * FROM followups WHERE id=?').get(this.ctx.params.followupId);
    if (!followup) this.ctx.throw(404, '追问不存在');
    if (!input.answer) this.ctx.throw(400, '请输入回答');
    this.service.db.setFollowup(followup.id, input.answer);
    const match = /^edge:([^:.]+)/.exec(followup.slot || '');
    let recalculated = null;
    if (match) {
      const answer = String(input.answer).toLowerCase();
      const negative = /(无效|失效|不可达|撤销|不再有效|不是)/.test(answer);
      const positive = !negative && /(仍然有效|仍有效|当前有效|是有效|可达|恢复|保留|有效)/.test(answer);
      if (negative !== positive) {
        this.service.db.db.prepare('UPDATE edges SET active=? WHERE id=? AND project_id=?').run(positive ? 1 : 0, match[1], followup.project_id);
        recalculated = this.service.risk.calculate(followup.project_id);
      }
    }
    this.service.db.audit(followup.project_id, 'followup_answer', `${followup.slot} / ${input.answer}`);
    ok(this.ctx, { followup: this.service.db.db.prepare('SELECT * FROM followups WHERE id=?').get(followup.id), recalculated: recalculated ? { count: recalculated.count } : null });
  }

  async regenerateFollowup() {
    const followup = this.service.db.db.prepare('SELECT * FROM followups WHERE id=?').get(this.ctx.params.followupId);
    if (!followup) this.ctx.throw(404, '追问不存在');
    try {
      const question = await this.service.llm.question(followup.slot, { title: followup.title, currentQuestion: followup.question });
      if (!question.trim()) throw new Error('模型未生成有效追问');
      this.service.db.db.prepare('UPDATE followups SET question=? WHERE id=?').run(question.trim(), followup.id);
      this.service.db.audit(followup.project_id, 'followup_generated', `${followup.slot} / ${process.env.LLM_MODEL}`);
      ok(this.ctx, this.service.db.db.prepare('SELECT * FROM followups WHERE id=?').get(followup.id));
    } catch (err) {
      this.ctx.status = 422;
      this.ctx.body = { ok: false, error: `真实模型追问生成失败：${err.message}` };
    }
  }

  async report() {
    const projectId = this.ctx.params.projectId;
    const project = this.service.db.project(projectId);
    if (!project) this.ctx.throw(404, '评估项目不存在');
    ok(this.ctx, { generatedAt: new Date().toISOString(), project, risks: this.service.db.risks(projectId), evidence: this.service.db.evidence(projectId), reviews: this.service.db.reviews(projectId), tasks: this.service.db.db.prepare('SELECT * FROM remediation_tasks WHERE project_id=?').all(projectId), formula: 'S=w1C+w2N+w3P+w4R+w5E+w6B-w7I; Tp=S+w7; Pt=min(1,Pp*(1+αTp)); Lt=λ1Av+λ2K+λ3D+λ4Ic; Rt=Pt*Lt' });
  }

  async reportPdf() {
    const projectId = this.ctx.params.projectId;
    const project = this.service.db.project(projectId);
    if (!project) this.ctx.throw(404, '评估项目不存在');
    const risks = this.service.db.risks(projectId);
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    this.ctx.type = 'application/pdf';
    this.ctx.set('Content-Disposition', `attachment; filename="risk-report-${projectId}.pdf"`);
    this.ctx.body = doc;
    const font = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
    // Noto CJK is a TrueType collection; pass the face name so fontkit
    // selects a concrete face instead of treating the collection itself as a font.
    if (fs.existsSync(font)) doc.font(font, 'NotoSansCJKsc-Regular');
    doc.fontSize(20).text('云计算跨层风险穿透评估报告', { align: 'center' }).moveDown();
    doc.fontSize(11).text(`项目：${project.name}`).text(`范围：${project.scope}`).text(`生成时间：${new Date().toLocaleString('zh-CN')}`).moveDown();
    doc.fontSize(14).text('评估结论').moveDown(.4);
    if (!risks.length) doc.fontSize(11).text('尚未生成风险结果，请在系统中执行计算。');
    risks.forEach((r, i) => {
      doc.fontSize(12).text(`${i + 1}. ${r.level}风险｜${r.source_id} → ${r.target_id}`);
      doc.fontSize(10).text(`路径：${r.path.nodes.join(' → ')}\n穿透评分：${r.penetration.toFixed(3)}｜租户风险值：${r.risk_value.toFixed(3)}\n依据：${r.reason}`).moveDown(.5);
    });
    doc.moveDown().fontSize(9).text('计算公式：S=w1C+w2N+w3P+w4R+w5E+w6B-w7I；Tp=S+w7；Pt=min(1,Pp×(1+αTp))；Lt=λ1Av+λ2K+λ3D+λ4Ic；Rt=Pt×Lt。');
    doc.end();
  }

  async readEvidence(file, originalName) {
    const ext = path.extname(originalName).toLowerCase();
    if (ext === '.docx') return (await mammoth.extractRawText({ path: file })).value;
    if (ext === '.pdf') {
      try {
        const { PDFParse } = require('pdf-parse');
        if (PDFParse) {
          const parser = new PDFParse({ data: fs.readFileSync(file) });
          try { return (await parser.getText()).text || ''; } finally { await parser.destroy(); }
        }
        const mod = require('pdf-parse');
        const result = await (typeof mod === 'function' ? mod : mod.default)(fs.readFileSync(file));
        return result.text || '';
      } catch (err) { throw new Error(`PDF 文本提取失败：${err.message}`); }
    }
    return fs.readFileSync(file, 'utf8');
  }
}

module.exports = ApiController;
