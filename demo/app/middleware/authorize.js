'use strict';

const { permissionFor } = require('../lib/access-control');

function cookie(ctx, name, value, options = {}) {
  ctx.cookies.set(name, value || null, {
    path: '/',
    httpOnly: options.httpOnly !== false,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    signed: false,
    overwrite: true,
    maxAge: options.maxAge || 0
  });
}

function deny(ctx, status, error, code) {
  ctx.status = status;
  ctx.body = { ok: false, error, code };
}

function sameOrigin(ctx) {
  const origin = ctx.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === ctx.get('host'); } catch { return false; }
}

module.exports = () => async (ctx, next) => {
  if (!ctx.path.startsWith('/api/v1/')) return next();
  ctx.set('Cache-Control', 'no-store');
  ctx.set('Referrer-Policy', 'no-referrer');
  const auth = ctx.service.auth;
  await auth.ensureBootstrap();

  if ([ '/api/v1/auth/status', '/api/v1/auth/setup', '/api/v1/auth/login' ].includes(ctx.path)) {
    if (ctx.path === '/api/v1/auth/login' && ctx.method === 'POST') {
      const address = ctx.ip || 'unknown';
      const now = Date.now();
      ctx.app.loginAttempts ||= new Map();
      for (const [ key, entry ] of ctx.app.loginAttempts) if (entry.resetAt <= now) ctx.app.loginAttempts.delete(key);
      const entry = ctx.app.loginAttempts.get(address) || { count: 0, resetAt: now + 60_000 };
      if (entry.count >= 20) return deny(ctx, 429, '登录尝试过多，请一分钟后重试', 'login_rate_limited');
      entry.count++;
      ctx.app.loginAttempts.set(address, entry);
    }
    if (ctx.path === '/api/v1/auth/setup' && !sameOrigin(ctx)) return deny(ctx, 403, '请求来源校验失败', 'origin_invalid');
    return next();
  }

  const token = ctx.cookies.get('risk_session', { signed: false });
  const principal = auth.resolve(token);
  if (!principal) return deny(ctx, 401, '请先登录', 'login_required');
  ctx.state.user = principal.user;
  ctx.state.principal = principal;

  const writing = ![ 'GET', 'HEAD', 'OPTIONS' ].includes(ctx.method);
  if (writing && !sameOrigin(ctx)) return deny(ctx, 403, '不允许跨站操作', 'origin_invalid');
  if (writing && ![ '/api/v1/auth/logout', '/api/v1/auth/password' ].includes(ctx.path)) {
    const tokenValue = ctx.get('x-csrf-token');
    if (!auth.checkCsrf(principal, tokenValue)) return deny(ctx, 403, '会话校验失败，请刷新页面后重试', 'csrf_invalid');
  }

  if (principal.user.mustChangePassword && ![ '/api/v1/auth/me', '/api/v1/auth/password', '/api/v1/auth/logout' ].includes(ctx.path)) return deny(ctx, 403, '请先修改初始密码', 'password_change_required');
  const permission = permissionFor(ctx.method, ctx.path);
  const bootstrapSecurityAdmin = permission === 'users.admin' && principal.user.roles.includes('SYSTEM_ADMIN') && !auth.db.prepare("SELECT 1 FROM app_users u JOIN app_user_roles r ON r.user_id=u.id WHERE u.status='ACTIVE' AND r.role_code='SECURITY_ADMIN' LIMIT 1").get();
  if (permission && permission !== 'authenticated' && !auth.hasPermission(principal.user, permission) && !bootstrapSecurityAdmin) return deny(ctx, 403, '当前账号没有执行此操作的权限', 'permission_denied');

  if (writing && !ctx.path.startsWith('/api/v1/auth/')) auth.event('API_MUTATION', principal.id, null, { method: ctx.method, path: ctx.path }, ctx.ip);
  await next();
};

module.exports.cookie = cookie;
