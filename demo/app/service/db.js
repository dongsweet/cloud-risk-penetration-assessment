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
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT, status TEXT DEFAULT 'draft', risk_config_json TEXT DEFAULT '{}', risk_summary_json TEXT DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT, layer TEXT, tenant TEXT, pool TEXT, value REAL DEFAULT 0, importance REAL DEFAULT 0, sensitivity REAL DEFAULT 0, availability REAL DEFAULT 0, impact REAL DEFAULT 0, risk_source INTEGER DEFAULT 0, risk_name TEXT, probability REAL DEFAULT 0, description TEXT, security_measures TEXT DEFAULT '', meta_json TEXT DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS edges (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, relation TEXT NOT NULL, active INTEGER DEFAULT 1, source TEXT, evidence_id TEXT, confidence REAL DEFAULT 0, factors_json TEXT DEFAULT '{}', valid_from TEXT, valid_to TEXT);
      CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, filename TEXT, type TEXT, content TEXT, status TEXT DEFAULT 'pending', extraction_json TEXT DEFAULT '{}', source TEXT, confidence REAL DEFAULT 0, error TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS risks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_id TEXT, target_id TEXT, path_json TEXT, valid INTEGER, score REAL, penetration REAL, penetration_level TEXT, probability REAL, loss REAL, risk_value REAL, level TEXT, priority INTEGER DEFAULT 5, recommendation TEXT DEFAULT '', review_required INTEGER DEFAULT 0, review_reasons_json TEXT DEFAULT '[]', evidence_chain_json TEXT DEFAULT '[]', source_layer TEXT, target_layer TEXT, tenant TEXT, business TEXT, factors_json TEXT, config_json TEXT DEFAULT '{}', reason TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, risk_id TEXT, field TEXT, before_value TEXT, after_value TEXT, reason TEXT, reviewer TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS followups (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slot TEXT, title TEXT, question TEXT, status TEXT DEFAULT 'open', answer TEXT, created_at TEXT NOT NULL, answered_at TEXT);
      CREATE TABLE IF NOT EXISTS remediation_tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, risk_id TEXT, title TEXT, owner TEXT, status TEXT DEFAULT 'open', due_date TEXT, priority INTEGER DEFAULT 3, recommendation TEXT DEFAULT '', created_at TEXT NOT NULL);
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
    ensureColumn('projects', 'risk_summary_json', "TEXT DEFAULT '{}'");
    ensureColumn('nodes', 'impact', 'REAL DEFAULT 0');
    ensureColumn('nodes', 'security_measures', "TEXT DEFAULT ''");
    ensureColumn('edges', 'evidence_id', 'TEXT');
    ensureColumn('risks', 'config_json', "TEXT DEFAULT '{}'");
    ensureColumn('risks', 'penetration_level', 'TEXT');
    ensureColumn('risks', 'priority', 'INTEGER DEFAULT 5');
    ensureColumn('risks', 'recommendation', "TEXT DEFAULT ''");
    ensureColumn('risks', 'review_required', 'INTEGER DEFAULT 0');
    ensureColumn('risks', 'review_reasons_json', "TEXT DEFAULT '[]'");
    ensureColumn('risks', 'evidence_chain_json', "TEXT DEFAULT '[]'");
    ensureColumn('risks', 'source_layer', "TEXT DEFAULT ''");
    ensureColumn('risks', 'target_layer', "TEXT DEFAULT ''");
    ensureColumn('risks', 'tenant', "TEXT DEFAULT ''");
    ensureColumn('risks', 'business', "TEXT DEFAULT ''");
    ensureColumn('remediation_tasks', 'priority', 'INTEGER DEFAULT 3');
    ensureColumn('remediation_tasks', 'recommendation', "TEXT DEFAULT ''");
    ensureColumn('reviews', 'entity_type', "TEXT DEFAULT 'risk'");
    ensureColumn('reviews', 'entity_id', "TEXT DEFAULT ''");
    this.seedAccessControl();
    this.seedSystemConfig();
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

  now() { return new Date().toISOString(); }
  project(id) { const p = this.db.prepare('SELECT * FROM projects WHERE id=?').get(id); return p ? { ...p, risk_config: JSON.parse(p.risk_config_json || '{}'), risk_summary: JSON.parse(p.risk_summary_json || '{}') } : null; }
  listProjects() { return this.db.prepare('SELECT p.*, (SELECT COUNT(*) FROM nodes n WHERE n.project_id=p.id) node_count, (SELECT COUNT(*) FROM edges e WHERE e.project_id=p.id) edge_count, (SELECT COUNT(*) FROM evidence v WHERE v.project_id=p.id) evidence_count, (SELECT COUNT(*) FROM risks r WHERE r.project_id=p.id) risk_count, (SELECT COUNT(*) FROM followups f WHERE f.project_id=p.id AND f.status=\'open\') open_followup_count FROM projects p ORDER BY updated_at DESC').all(); }
  nodes(projectId) { return this.db.prepare('SELECT * FROM nodes WHERE project_id=? ORDER BY layer, id').all(projectId).map(n => ({ ...n, meta: JSON.parse(n.meta_json || '{}'), securityMeasures: n.security_measures || '' })); }
  edges(projectId) { return this.db.prepare('SELECT * FROM edges WHERE project_id=? ORDER BY id').all(projectId).map(e => ({ ...e, factors: JSON.parse(e.factors_json || '{}'), active: !!e.active })); }
  evidence(projectId) { return this.db.prepare('SELECT id,project_id,filename,type,status,extraction_json,source,confidence,error,created_at,CASE WHEN LENGTH(TRIM(content))>0 THEN 1 ELSE 0 END AS has_content FROM evidence WHERE project_id=? ORDER BY created_at DESC').all(projectId).map(e => ({ ...e, extraction: JSON.parse(e.extraction_json || '{}') })); }
  risks(projectId) { return this.db.prepare('SELECT * FROM risks WHERE project_id=? ORDER BY priority ASC, risk_value DESC, created_at DESC').all(projectId).map(r => ({ ...r, path: JSON.parse(r.path_json || '[]'), factors: JSON.parse(r.factors_json || '{}'), config: JSON.parse(r.config_json || '{}'), reviewReasons: JSON.parse(r.review_reasons_json || '[]'), evidenceChain: JSON.parse(r.evidence_chain_json || '[]'), valid: !!r.valid, reviewRequired: !!r.review_required })); }
  riskEvidenceChain(projectId, path) {
    const ids = new Set();
    const nodeIds = path.nodes || [];
    if (nodeIds.length) this.db.prepare(`SELECT id,meta_json FROM nodes WHERE project_id=? AND id IN (${nodeIds.map(() => '?').join(',')})`).all(projectId, ...nodeIds).forEach(n => { const meta = JSON.parse(n.meta_json || '{}'); if (meta.evidenceId) ids.add(meta.evidenceId); });
    const edgeIds = path.edges || [];
    if (edgeIds.length) this.db.prepare(`SELECT evidence_id,source FROM edges WHERE project_id=? AND id IN (${edgeIds.map(() => '?').join(',')})`).all(projectId, ...edgeIds).forEach(e => { if (e.evidence_id) ids.add(e.evidence_id); const match = String(e.source || '').match(/(EV-[\w-]+)/); if (match) ids.add(match[1]); });
    if (!ids.size) return [];
    return this.db.prepare(`SELECT id,filename,type,status,source,confidence,created_at FROM evidence WHERE project_id=? AND id IN (${[ ...ids ].map(() => '?').join(',')})`).all(projectId, ...ids).map(e => ({ id: e.id, filename: e.filename, type: e.type, status: e.status, source: e.source, confidence: e.confidence, createdAt: e.created_at }));
  }
  followups(projectId) { return this.db.prepare('SELECT * FROM followups WHERE project_id=? ORDER BY status DESC, created_at DESC').all(projectId); }
  reviews(projectId) { return this.db.prepare('SELECT * FROM reviews WHERE project_id=? ORDER BY created_at DESC').all(projectId); }
  audit(projectId, action, detail, actor = 'system') { const timestamp = this.now(); this.db.prepare('INSERT INTO audit_logs (project_id,action,detail,actor,created_at) VALUES (?,?,?,?,?)').run(projectId, action, detail, actor, timestamp); if (projectId) this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(timestamp, projectId); }
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
