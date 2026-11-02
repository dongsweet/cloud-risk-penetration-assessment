'use strict';

const Service = require('egg').Service;
const crypto = require('crypto');
const { promisify } = require('util');
const { ROLES, OPERATOR_SCOPES, ROLE_PERMISSIONS, hasPermission } = require('../lib/access-control');

const scrypt = promisify(crypto.scrypt);
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const now = () => new Date().toISOString();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const failure = (message, status = 400, code = 'auth_error') => Object.assign(new Error(message), { status, code });

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 256) throw failure('密码至少 12 个字符，最多 256 字节');
}

class AuthService extends Service {
  get db() { return this.service.db.db; }

  async hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    validatePassword(password);
    const digest = await scrypt(password, salt, 64, SCRYPT_OPTIONS);
    return { hash: digest.toString('hex'), salt };
  }

  labels() { return Object.fromEntries(Object.entries(ROLES).map(([ code, value ]) => [ code, value.name ])); }
  scopeLabels() { return OPERATOR_SCOPES; }

  principalUser(row) {
    if (!row) return null;
    const roles = this.db.prepare('SELECT role_code FROM app_user_roles WHERE user_id=? ORDER BY role_code').all(row.id).map(x => x.role_code);
    const scopes = this.db.prepare('SELECT scope_code FROM app_user_scopes WHERE user_id=? ORDER BY scope_code').all(row.id).map(x => x.scope_code);
    return { id: row.id, username: row.username, displayName: row.display_name, status: row.status, roles, scopes, mustChangePassword: Boolean(row.must_change_password), lastLoginAt: row.last_login_at, lockedUntil: row.locked_until, createdAt: row.created_at };
  }

  getUser(id) { return this.principalUser(this.db.prepare('SELECT * FROM app_users WHERE id=?').get(id)); }
  getUserByName(username) { return this.principalUser(this.db.prepare('SELECT * FROM app_users WHERE username=?').get(String(username || '').trim().toLowerCase())); }
  listUsers() { return this.db.prepare('SELECT * FROM app_users ORDER BY username').all().map(row => this.principalUser(row)); }
  roleDefinitions() { return this.labels(); }

  async ensureBootstrap() {
    if (this.db.prepare('SELECT COUNT(*) AS n FROM app_users').get().n) return;
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!password) return;
    await this.createUser({ username: process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin', displayName: process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME || '系统管理员', password, roles: [ 'SYSTEM_ADMIN' ], scopes: [] }, 'system', { bootstrap: true });
  }

  async createUser(input = {}, actor = 'system', { bootstrap = false } = {}) {
    const username = String(input.username || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9._-]{2,63}$/.test(username)) throw failure('用户名需为 3 至 64 位小写字母、数字、点、下划线或连字符');
    const displayName = String(input.displayName || '').trim();
    if (!displayName || displayName.length > 100) throw failure('显示名称不能为空且最多 100 个字符');
    const roles = [ ...new Set(Array.isArray(input.roles) ? input.roles : []) ];
    if (!roles.length || roles.some(role => !ROLES[role])) throw failure('请选择有效角色');
    const scopes = [ ...new Set(Array.isArray(input.scopes) ? input.scopes : []) ];
    if (scopes.some(scope => !OPERATOR_SCOPES[scope]) || (scopes.length && !roles.includes('OPERATOR'))) throw failure('操作员职责范围无效');
    const status = input.status || 'ACTIVE';
    if (!['ACTIVE', 'DISABLED'].includes(status)) throw failure('账号状态无效');
    const password = input.password;
    validatePassword(password);
    const existing = this.db.prepare('SELECT id FROM app_users WHERE username=?').get(username);
    if (existing) throw failure('用户名已存在', 409, 'username_exists');
    const credential = await this.hashPassword(password || crypto.randomBytes(32).toString('base64url'));
    const id = `USR-${crypto.randomUUID()}`;
    const timestamp = now();
    const tx = this.db.transaction(() => {
      this.db.prepare('INSERT INTO app_users(id,username,display_name,password_hash,password_salt,status,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, username, displayName, credential.hash, credential.salt, status, 1, timestamp, timestamp);
      const roleInsert = this.db.prepare('INSERT INTO app_user_roles(user_id,role_code) VALUES(?,?)');
      roles.forEach(role => roleInsert.run(id, role));
      const scopeInsert = this.db.prepare('INSERT INTO app_user_scopes(user_id,scope_code) VALUES(?,?)');
      scopes.forEach(scope => scopeInsert.run(id, scope));
      this.event(bootstrap ? 'ADMIN_BOOTSTRAPPED' : 'USER_CREATED', actor, id, { username, roles, scopes });
    });
    tx();
    return this.getUser(id);
  }

  updateUser(id, input = {}, actor) {
    const user = this.getUser(id);
    if (!user) throw failure('账号不存在', 404, 'user_not_found');
    const roles = [ ...new Set(input.roles ?? user.roles) ];
    const scopes = [ ...new Set(input.scopes ?? user.scopes) ];
    if (!roles.length || roles.some(role => !ROLES[role])) throw failure('请选择有效角色');
    if (scopes.some(scope => !OPERATOR_SCOPES[scope]) || (scopes.length && !roles.includes('OPERATOR'))) throw failure('操作员职责范围无效');
    const status = input.status ?? user.status;
    if (!['ACTIVE', 'DISABLED'].includes(status)) throw failure('账号状态无效');
    if (id === actor && (status !== 'ACTIVE' || !roles.length)) throw failure('不能禁用自己或移除自己的角色');
    const activeAdmins = this.db.prepare("SELECT COUNT(*) AS n FROM app_users u JOIN app_user_roles r ON r.user_id=u.id WHERE u.status='ACTIVE' AND r.role_code='SYSTEM_ADMIN'").get().n;
    if (user.roles.includes('SYSTEM_ADMIN') && (!roles.includes('SYSTEM_ADMIN') || status !== 'ACTIVE') && activeAdmins <= 1) throw failure('至少保留一个有效系统管理员');
    const displayName = String(input.displayName ?? user.displayName).trim();
    if (!displayName || displayName.length > 100) throw failure('显示名称不能为空且最多 100 个字符');
    this.db.transaction(() => {
      this.db.prepare('UPDATE app_users SET display_name=?,status=?,updated_at=? WHERE id=?').run(displayName, status, now(), id);
      this.db.prepare('DELETE FROM app_user_roles WHERE user_id=?').run(id);
      this.db.prepare('DELETE FROM app_user_scopes WHERE user_id=?').run(id);
      roles.forEach(role => this.db.prepare('INSERT INTO app_user_roles(user_id,role_code) VALUES(?,?)').run(id, role));
      scopes.forEach(scope => this.db.prepare('INSERT INTO app_user_scopes(user_id,scope_code) VALUES(?,?)').run(id, scope));
      this.revoke(id);
      this.event('USER_UPDATED', actor, id, { roles, scopes, status });
    })();
    return this.getUser(id);
  }

  async resetPassword(id, password, actor) {
    const user = this.getUser(id);
    if (!user) throw failure('账号不存在', 404, 'user_not_found');
    const credential = await this.hashPassword(password);
    this.db.prepare('UPDATE app_users SET password_hash=?,password_salt=?,must_change_password=1,failed_attempts=0,locked_until=NULL,updated_at=? WHERE id=?').run(credential.hash, credential.salt, now(), id);
    this.revoke(id);
    this.event('PASSWORD_RESET', actor, id, {});
  }

  async changePassword(id, oldPassword, password) {
    const row = this.db.prepare('SELECT * FROM app_users WHERE id=?').get(id);
    if (!row) throw failure('账号不存在', 404, 'user_not_found');
    const digest = await scrypt(String(oldPassword || ''), row.password_salt, 64, SCRYPT_OPTIONS);
    if (!crypto.timingSafeEqual(digest, Buffer.from(row.password_hash, 'hex'))) throw failure('原密码不正确', 400, 'password_invalid');
    const credential = await this.hashPassword(password);
    this.db.prepare('UPDATE app_users SET password_hash=?,password_salt=?,must_change_password=0,failed_attempts=0,locked_until=NULL,updated_at=? WHERE id=?').run(credential.hash, credential.salt, now(), id);
    this.revoke(id);
    this.event('PASSWORD_CHANGED', id, id, {});
  }

  async login(username, password, address, userAgent) {
    const row = this.db.prepare('SELECT * FROM app_users WHERE username=?').get(String(username || '').trim().toLowerCase());
    const salt = row?.password_salt || crypto.randomBytes(16).toString('hex');
    const digest = await scrypt(String(password || ''), salt, 64, SCRYPT_OPTIONS);
    const valid = row && crypto.timingSafeEqual(digest, Buffer.from(row.password_hash, 'hex'));
    if (!valid || !row || row.status !== 'ACTIVE' || (row.locked_until && row.locked_until > Date.now())) {
      if (row && row.status === 'ACTIVE') this.db.prepare('UPDATE app_users SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts+1>=5 THEN ? ELSE locked_until END WHERE id=?').run(Date.now() + 15 * 60 * 1000, row.id);
      this.event('LOGIN_FAILED', row?.id || null, row?.id || null, {}, address);
      throw failure('用户名或密码错误', 401, 'login_failed');
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(32).toString('base64url');
    const timestamp = Date.now();
    const config = this.service.db.systemConfig();
    this.db.prepare('INSERT INTO app_sessions(session_id,user_id,token_hash,csrf_hash,created_at,expires_at,last_seen_at,source_address,user_agent) VALUES(?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), row.id, hash(token), hash(csrf), timestamp, timestamp + config.sessionAbsoluteHours * 3600000, timestamp, address || null, userAgent || null);
    this.db.prepare('UPDATE app_users SET failed_attempts=0,locked_until=NULL,last_login_at=?,updated_at=? WHERE id=?').run(now(), now(), row.id);
    this.event('LOGIN_SUCCEEDED', row.id, row.id, {}, address);
    return { token, csrf, user: this.getUser(row.id) };
  }

  resolve(token) {
    if (!token || token.length < 40) return null;
    const row = this.db.prepare('SELECT s.*,u.* FROM app_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=?').get(hash(token));
    if (!row || row.revoked_at || row.expires_at <= Date.now() || row.last_seen_at + this.service.db.systemConfig().sessionIdleMinutes * 60000 <= Date.now() || row.status !== 'ACTIVE') return null;
    this.db.prepare('UPDATE app_sessions SET last_seen_at=? WHERE session_id=?').run(Date.now(), row.session_id);
    return { id: row.id, user: this.getUser(row.id), roles: this.getUser(row.id).roles, sessionId: row.session_id, csrfHash: row.csrf_hash };
  }

  checkCsrf(principal, value) { return Boolean(principal && value && hash(value) === principal.csrfHash); }
  revoke(id) { this.db.prepare('UPDATE app_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(Date.now(), id); }
  logout(principal) { if (principal?.sessionId) this.db.prepare('UPDATE app_sessions SET revoked_at=? WHERE session_id=?').run(Date.now(), principal.sessionId); if (principal) this.event('LOGOUT', principal.id, principal.id, {}); }
  hasPermission(user, permission) { return hasPermission(user, permission); }
  event(type, actor, target, details = {}, address = null) { this.db.prepare('INSERT INTO auth_events(event_id,actor_user_id,target_user_id,event_type,details_json,source_address,created_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(), actor, target, type, JSON.stringify(details), address, now()); }
}

module.exports = AuthService;
