'use strict';

const Service = require('egg').Service;
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { ROLES, OPERATOR_SCOPES, ROLE_PERMISSIONS } = require('../lib/access-control');
const { DEFAULTS } = require('../lib/risk-engine');

const DEFAULT_SYSTEM_CONFIG = Object.freeze({
  systemName: '云盾 RiskLab',
  organization: '',
  sessionIdleMinutes: 30,
  sessionAbsoluteHours: 8,
  llmBaseUrl: '',
  llmModel: '',
  llmTimeoutMs: 60000,
  lowConfidenceThreshold: 0.65,
  defaultRiskConfig: DEFAULTS
});

const seedNodes = [
  { id: 'H01', name: 'H01 宿主机', kind: 'host', layer: 'platform', tenant: '', pool: 'R01', value: .75, importance: .75, sensitivity: .5, availability: .9, riskSource: 1, riskName: '虚拟化组件脆弱性', probability: .45, description: '承载租户虚拟机的计算宿主机' },
  { id: 'V1', name: 'V1 虚拟化组件', kind: 'virtualization', layer: 'platform', tenant: '', pool: 'R01', value: .8, importance: .8, sensitivity: .6, availability: .9, riskSource: 1, riskName: '虚拟化组件高危漏洞', probability: .5, description: '宿主机侧虚拟化组件' },
  { id: 'VM-A1', name: 'VM-A1 租户虚拟机', kind: 'vm', layer: 'tenant', tenant: '租户 A', pool: 'R01', value: .8, importance: .85, sensitivity: .8, availability: .9, riskSource: 0, description: '部署政务服务业务的计算资产' },
  { id: 'DB-A', name: 'DB-A 租户数据库', kind: 'database', layer: 'tenant', tenant: '租户 A', pool: 'R01', value: .95, importance: .95, sensitivity: 1, availability: .95, riskSource: 0, description: '存储业务核心数据的数据库' },
  { id: 'BIZ-A', name: '政务服务事项业务', kind: 'business', layer: 'tenant', tenant: '租户 A', pool: 'R01', value: 1, importance: 1, sensitivity: .9, availability: 1, riskSource: 0, description: '面向公众的核心政务服务' },
  { id: 'U01', name: 'U01 平台运维账号', kind: 'account', layer: 'platform', tenant: '', pool: 'R01', value: .7, importance: .8, sensitivity: .7, availability: .8, riskSource: 1, riskName: '运维账号权限配置错误', probability: .35, description: '具有资源池运维权限的平台账号' },
  { id: 'R01', name: '资源池 R01', kind: 'resource_pool', layer: 'platform', tenant: '', pool: 'R01', value: .75, importance: .8, sensitivity: .7, availability: .9, riskSource: 0, description: '承载租户 A 资源的共享资源池' },
  { id: 'SG01', name: 'SG01 租户隔离安全组', kind: 'security_control', layer: 'control', tenant: '租户 A', pool: 'R01', value: .8, importance: .85, sensitivity: .5, availability: .9, riskSource: 0, description: '限制跨租户访问的安全控制' }
];

const seedEdges = [
  { id: 'E01', from: 'H01', to: 'V1', relation: '组件关系', active: 1, source: '云平台 CMDB', confidence: .98, factors: { C: .95, N: .55, P: .2, R: .75, E: .5, B: .4, I: .25 } },
  { id: 'E02', from: 'V1', to: 'VM-A1', relation: '承载关系', active: 1, source: '云平台 API', confidence: .97, factors: { C: 1, N: .65, P: .35, R: .85, E: .75, B: .8, I: .25 } },
  { id: 'E03', from: 'VM-A1', to: 'DB-A', relation: '部署关系', active: 1, source: '应用拓扑文档', confidence: .92, factors: { C: .7, N: .8, P: .5, R: .45, E: .6, B: .95, I: .35 } },
  { id: 'E04', from: 'DB-A', to: 'BIZ-A', relation: '支撑关系', active: 1, source: '业务说明文档', confidence: .95, factors: { C: .65, N: .7, P: .4, R: .3, E: .55, B: 1, I: .35 } },
  { id: 'E05', from: 'U01', to: 'R01', relation: '权限关系', active: 1, source: '权限审计日志', confidence: .88, factors: { C: .3, N: .7, P: 1, R: .8, E: .9, B: .65, I: .2 } },
  { id: 'E06', from: 'R01', to: 'VM-A1', relation: '归属关系', active: 1, source: '资源池清单', confidence: .96, factors: { C: .75, N: .6, P: .35, R: 1, E: .7, B: .65, I: .3 } },
  { id: 'E07', from: 'R01', to: 'DB-A', relation: '共享资源关系', active: 1, source: '存储资源清单', confidence: .9, factors: { C: .65, N: .6, P: .3, R: 1, E: .65, B: .8, I: .35 } },
  { id: 'E08', from: 'U01', to: 'DB-A', relation: '直接权限关系', active: 0, source: '历史权限配置', confidence: .62, factors: { C: .2, N: .7, P: .9, R: .4, E: .8, B: .85, I: .1 } },
  { id: 'E09', from: 'SG01', to: 'DB-A', relation: '隔离控制', active: 1, source: '安全组配置', confidence: .91, factors: { C: .2, N: .2, P: .15, R: .2, E: .15, B: .75, I: .95 } }
];

class DbService extends Service {
  get db() {
    if (!this._db) {
      const dir = process.env.DATA_DIR || path.join(this.app.baseDir, 'data');
      fs.mkdirSync(dir, { recursive: true });
      this._db = new Database(path.join(dir, 'risk-demo.db'));
      this._db.pragma('journal_mode = WAL');
      this._init();
    }
    return this._db;
  }

  _init() {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT, status TEXT DEFAULT 'draft', risk_config_json TEXT DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT, layer TEXT, tenant TEXT, pool TEXT, value REAL DEFAULT 0, importance REAL DEFAULT 0, sensitivity REAL DEFAULT 0, availability REAL DEFAULT 0, impact REAL DEFAULT 0, risk_source INTEGER DEFAULT 0, risk_name TEXT, probability REAL DEFAULT 0, description TEXT, meta_json TEXT DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS edges (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, relation TEXT NOT NULL, active INTEGER DEFAULT 1, source TEXT, confidence REAL DEFAULT 0, factors_json TEXT DEFAULT '{}', valid_from TEXT, valid_to TEXT);
      CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, filename TEXT, type TEXT, content TEXT, status TEXT DEFAULT 'pending', extraction_json TEXT DEFAULT '{}', source TEXT, confidence REAL DEFAULT 0, error TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS risks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_id TEXT, target_id TEXT, path_json TEXT, valid INTEGER, score REAL, penetration REAL, probability REAL, loss REAL, risk_value REAL, level TEXT, factors_json TEXT, config_json TEXT DEFAULT '{}', reason TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, risk_id TEXT, field TEXT, before_value TEXT, after_value TEXT, reason TEXT, reviewer TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS followups (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slot TEXT, title TEXT, question TEXT, status TEXT DEFAULT 'open', answer TEXT, created_at TEXT NOT NULL, answered_at TEXT);
      CREATE TABLE IF NOT EXISTS remediation_tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, risk_id TEXT, title TEXT, owner TEXT, status TEXT DEFAULT 'open', due_date TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, action TEXT, detail TEXT, actor TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', must_change_password INTEGER NOT NULL DEFAULT 1, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER, last_login_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS app_user_roles (user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE, role_code TEXT NOT NULL, PRIMARY KEY(user_id, role_code));
      CREATE TABLE IF NOT EXISTS app_user_scopes (user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE, scope_code TEXT NOT NULL, PRIMARY KEY(user_id, scope_code));
      CREATE TABLE IF NOT EXISTS app_sessions (session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, csrf_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, revoked_at INTEGER, source_address TEXT, user_agent TEXT);
      CREATE INDEX IF NOT EXISTS app_sessions_user_idx ON app_sessions(user_id);
      CREATE TABLE IF NOT EXISTS auth_events (event_id TEXT PRIMARY KEY, actor_user_id TEXT, target_user_id TEXT, event_type TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', source_address TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS auth_events_created_idx ON auth_events(created_at DESC);
      CREATE TABLE IF NOT EXISTS system_settings (setting_key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL);
    `);
    const ensureColumn = (table, column, definition) => {
      const columns = this._db.prepare(`PRAGMA table_info(${table})`).all().map(x => x.name);
      if (!columns.includes(column)) this._db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    };
    ensureColumn('projects', 'risk_config_json', "TEXT DEFAULT '{}'");
    ensureColumn('nodes', 'impact', 'REAL DEFAULT 0');
    ensureColumn('risks', 'config_json', "TEXT DEFAULT '{}'");
    this.seedAccessControl();
    this.seedSystemConfig();
    const count = this._db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
    if (!count) this.seed();
  }

  seedAccessControl() {
    this._db.exec('CREATE TABLE IF NOT EXISTS app_roles (role_code TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL); CREATE TABLE IF NOT EXISTS app_role_permissions (role_code TEXT NOT NULL, permission_code TEXT NOT NULL, PRIMARY KEY(role_code,permission_code));');
    const role = this._db.prepare('INSERT INTO app_roles (role_code,name,description) VALUES (?,?,?) ON CONFLICT(role_code) DO UPDATE SET name=excluded.name,description=excluded.description');
    const permission = this._db.prepare('INSERT INTO app_role_permissions (role_code,permission_code) VALUES (?,?) ON CONFLICT DO NOTHING');
    for (const [ code, def ] of Object.entries(ROLES)) {
      role.run(code, def.name, def.description);
      for (const item of ROLE_PERMISSIONS[code] || []) permission.run(code, item);
    }
    this._db.exec("CREATE TABLE IF NOT EXISTS app_operator_scopes (scope_code TEXT PRIMARY KEY, name TEXT NOT NULL); INSERT INTO app_operator_scopes(scope_code,name) VALUES ('assess','评估'),('review','复核') ON CONFLICT(scope_code) DO UPDATE SET name=excluded.name;");
  }

  seedSystemConfig() {
    const current = this._db.prepare('SELECT value_json FROM system_settings WHERE setting_key=?').get('system');
    if (!current) this._db.prepare('INSERT INTO system_settings (setting_key,value_json,updated_by,updated_at) VALUES (?,?,?,?)').run('system', JSON.stringify(DEFAULT_SYSTEM_CONFIG), 'system', this.now());
  }

  seed() {
    const now = new Date().toISOString();
    const project = { id: 'PRJ-DEMO-001', name: '政务云跨层风险穿透评估演示', scope: '平台侧基础设施、租户 A 业务与数据资产、权限和隔离控制', status: 'in_review' };
    const insertProject = this._db.prepare('INSERT INTO projects (id,name,scope,status,created_at,updated_at) VALUES (@id,@name,@scope,@status,@created_at,@updated_at)');
    const insertNode = this._db.prepare('INSERT INTO nodes (id,project_id,name,kind,layer,tenant,pool,value,importance,sensitivity,availability,impact,risk_source,risk_name,probability,description,meta_json) VALUES (@id,@project_id,@name,@kind,@layer,@tenant,@pool,@value,@importance,@sensitivity,@availability,@impact,@risk_source,@risk_name,@probability,@description,@meta_json)');
    const insertEdge = this._db.prepare('INSERT INTO edges (id,project_id,from_id,to_id,relation,active,source,confidence,factors_json) VALUES (@id,@project_id,@from_id,@to_id,@relation,@active,@source,@confidence,@factors_json)');
    const insertEvidence = this._db.prepare('INSERT INTO evidence (id,project_id,filename,type,content,status,extraction_json,source,confidence,created_at) VALUES (@id,@project_id,@filename,@type,@content,@status,@extraction_json,@source,@confidence,@created_at)');
    const insertFollowup = this._db.prepare('INSERT INTO followups (id,project_id,slot,title,question,status,created_at) VALUES (@id,@project_id,@slot,@title,@question,@status,@created_at)');
    const insertTask = this._db.prepare('INSERT INTO remediation_tasks (id,project_id,risk_id,title,owner,status,due_date,created_at) VALUES (@id,@project_id,@risk_id,@title,@owner,@status,@due_date,@created_at)');
    const tx = this._db.transaction(() => {
      insertProject.run({ ...project, created_at: now, updated_at: now });
      for (const n of seedNodes) insertNode.run({ ...n, impact: n.impact ?? n.availability, project_id: project.id, risk_name: n.riskName || '', risk_source: n.riskSource || 0, probability: n.probability || 0, meta_json: JSON.stringify({ source: '演示样例数据' }) });
      for (const e of seedEdges) insertEdge.run({ ...e, project_id: project.id, from_id: e.from, to_id: e.to, factors_json: JSON.stringify(e.factors) });
      insertEvidence.run({ id: 'EV-001', project_id: project.id, filename: '虚拟化组件漏洞扫描报告.txt', type: 'txt', content: '扫描发现 V1 虚拟化组件存在高危漏洞，影响承载于 H01 的租户虚拟机。来源：漏洞扫描平台。', status: 'extracted', extraction_json: JSON.stringify({ assets: [ 'H01', 'V1', 'VM-A1' ], risks: [ '虚拟化组件高危漏洞' ], relations: [ 'H01 承载 VM-A1' ] }), source: '漏洞扫描平台 / 2026-10-28', confidence: .94, created_at: now });
      insertEvidence.run({ id: 'EV-002', project_id: project.id, filename: '租户 A 业务说明.txt', type: 'txt', content: 'DB-A 存储政务服务事项业务核心数据，属于高敏感数据，业务重要性高。', status: 'extracted', extraction_json: JSON.stringify({ assets: [ 'DB-A', 'BIZ-A' ], businessImportance: '高', sensitivity: '高' }), source: '业务说明文档 / 2026-10-27', confidence: .95, created_at: now });
      insertEvidence.run({ id: 'EV-003', project_id: project.id, filename: '权限审计日志.csv', type: 'csv', content: 'U01,R01,权限关系,管理权限,2026-10-29', status: 'extracted', extraction_json: JSON.stringify({ assets: [ 'U01', 'R01' ], permission: '管理权限' }), source: '权限审计平台 / 2026-10-29', confidence: .88, created_at: now });
      insertFollowup.run({ id: 'FU-001', project_id: project.id, slot: 'edge:E08.source', title: '历史权限关系待确认', question: '历史配置显示 U01 可能直接访问 DB-A，但证据置信度较低且关系当前已失效。请确认该关系是否在当前权限状态下仍然有效，并提供最新审计记录。', status: 'open', created_at: now });
      insertTask.run({ id: 'TASK-001', project_id: project.id, risk_id: '', title: '升级 V1 虚拟化组件并复核租户隔离', owner: '云平台运维组', status: 'open', due_date: '2026-11-15', created_at: now });
      this._db.prepare('INSERT INTO audit_logs (project_id,action,detail,actor,created_at) VALUES (?,?,?,?,?)').run(project.id, 'seed', '初始化演示数据', 'system', now);
    });
    tx();
  }

  now() { return new Date().toISOString(); }
  project(id) { const p = this.db.prepare('SELECT * FROM projects WHERE id=?').get(id); return p ? { ...p, risk_config: JSON.parse(p.risk_config_json || '{}') } : null; }
  listProjects() { return this.db.prepare('SELECT p.*, (SELECT COUNT(*) FROM nodes n WHERE n.project_id=p.id) node_count, (SELECT COUNT(*) FROM risks r WHERE r.project_id=p.id) risk_count FROM projects p ORDER BY updated_at DESC').all(); }
  nodes(projectId) { return this.db.prepare('SELECT * FROM nodes WHERE project_id=? ORDER BY layer, id').all(projectId).map(n => ({ ...n, meta: JSON.parse(n.meta_json || '{}') })); }
  edges(projectId) { return this.db.prepare('SELECT * FROM edges WHERE project_id=? ORDER BY id').all(projectId).map(e => ({ ...e, factors: JSON.parse(e.factors_json || '{}'), active: !!e.active })); }
  evidence(projectId) { return this.db.prepare('SELECT id,project_id,filename,type,status,extraction_json,source,confidence,error,created_at,CASE WHEN LENGTH(TRIM(content))>0 THEN 1 ELSE 0 END AS has_content FROM evidence WHERE project_id=? ORDER BY created_at DESC').all(projectId).map(e => ({ ...e, extraction: JSON.parse(e.extraction_json || '{}') })); }
  risks(projectId) { return this.db.prepare('SELECT * FROM risks WHERE project_id=? ORDER BY risk_value DESC, created_at DESC').all(projectId).map(r => ({ ...r, path: JSON.parse(r.path_json || '[]'), factors: JSON.parse(r.factors_json || '{}'), config: JSON.parse(r.config_json || '{}'), valid: !!r.valid })); }
  followups(projectId) { return this.db.prepare('SELECT * FROM followups WHERE project_id=? ORDER BY status DESC, created_at DESC').all(projectId); }
  reviews(projectId) { return this.db.prepare('SELECT * FROM reviews WHERE project_id=? ORDER BY created_at DESC').all(projectId); }
  audit(projectId, action, detail, actor = 'system') { this.db.prepare('INSERT INTO audit_logs (project_id,action,detail,actor,created_at) VALUES (?,?,?,?,?)').run(projectId, action, detail, actor, this.now()); }
  systemConfig() {
    const row = this.db.prepare('SELECT value_json,updated_by,updated_at FROM system_settings WHERE setting_key=?').get('system');
    const value = row ? JSON.parse(row.value_json || '{}') : { ...DEFAULT_SYSTEM_CONFIG };
    return { ...value, llmApiKeyConfigured: Boolean(process.env.LLM_API_KEY), updatedBy: row?.updated_by || 'system', updatedAt: row?.updated_at || null };
  }
  saveSystemConfig(input, actor = 'system') {
    const current = this.systemConfig();
    const number = (value, fallback, min, max) => {
      const n = Number(value ?? fallback);
      if (!Number.isFinite(n) || n < min || n > max) throw new Error(`配置数值必须在 ${min} 到 ${max} 之间`);
      return n;
    };
    const next = {
      systemName: String(input.systemName ?? current.systemName).trim().slice(0, 80) || current.systemName,
      organization: String(input.organization ?? current.organization).trim().slice(0, 120),
      sessionIdleMinutes: number(input.sessionIdleMinutes, current.sessionIdleMinutes, 5, 240),
      sessionAbsoluteHours: number(input.sessionAbsoluteHours, current.sessionAbsoluteHours, 1, 72),
      llmBaseUrl: String(input.llmBaseUrl ?? current.llmBaseUrl).trim().replace(/\/$/, '').slice(0, 500),
      llmModel: String(input.llmModel ?? current.llmModel).trim().slice(0, 160),
      llmTimeoutMs: number(input.llmTimeoutMs, current.llmTimeoutMs, 1000, 120000),
      lowConfidenceThreshold: number(input.lowConfidenceThreshold, current.lowConfidenceThreshold, 0, 1),
      defaultRiskConfig: current.defaultRiskConfig
    };
    this.db.prepare('INSERT INTO system_settings(setting_key,value_json,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run('system', JSON.stringify(next), actor, this.now());
    return this.systemConfig();
  }
  setFollowup(id, answer) { this.db.prepare("UPDATE followups SET status='answered',answer=?,answered_at=? WHERE id=?").run(answer, this.now(), id); }
}

module.exports = DbService;
