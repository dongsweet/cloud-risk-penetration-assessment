'use strict';

const ROLES = Object.freeze({
  SYSTEM_ADMIN: { name: '系统管理员', description: '维护模型服务与系统运行配置' },
  SECURITY_ADMIN: { name: '安全管理员', description: '管理本地账号、角色与状态' },
  OPERATOR: { name: '操作员', description: '按分配的评估/复核职责处理业务' },
  AUDITOR: { name: '审计管理员', description: '只读查看业务材料、报告与审计记录' }
});

const OPERATOR_SCOPES = Object.freeze({
  assess: '评估（证据、计算、追问、整改）',
  review: '复核（风险结果修订回写）'
});

const ROLE_PERMISSIONS = Object.freeze({
  SYSTEM_ADMIN: [ 'dashboard.read', 'business.read', 'report.read', 'system.config.read', 'system.config.write', 'risk.config.write', 'project.write' ],
  SECURITY_ADMIN: [ 'dashboard.read', 'business.read', 'report.read', 'users.admin' ],
  OPERATOR: [ 'dashboard.read', 'business.read', 'report.read' ],
  AUDITOR: [ 'dashboard.read', 'business.read', 'report.read', 'audit.read' ]
});

function hasPermission(user, permission) {
  if (!user || user.status !== 'ACTIVE') return false;
  for (const role of user.roles || []) {
    if ((ROLE_PERMISSIONS[role] || []).includes(permission)) return true;
    if (role === 'SYSTEM_ADMIN' && permission === 'risk.config.write') return true;
    if (role === 'OPERATOR' && user.scopes?.includes('assess') && [ 'evidence.write', 'assessment.write', 'risk.config.write', 'project.write' ].includes(permission)) return true;
    if (role === 'OPERATOR' && user.scopes?.includes('review') && permission === 'review.write') return true;
  }
  return false;
}

function permissionFor(method, pathname) {
  if (pathname === '/api/v1/auth/status' || pathname === '/api/v1/auth/setup' || pathname === '/api/v1/auth/login') return null;
  if ([ '/api/v1/auth/me', '/api/v1/auth/logout', '/api/v1/auth/password' ].includes(pathname)) return 'authenticated';
  if (pathname === '/api/v1/dashboard') return 'dashboard.read';
  if (pathname === '/api/v1/system/config') return method === 'GET' ? 'system.config.read' : 'system.config.write';
  if (pathname === '/api/v1/users' || /^\/api\/v1\/users\/[^/]+(?:\/password)?$/.test(pathname)) return 'users.admin';
  if (pathname.startsWith('/api/v1/audit/') || pathname === '/api/v1/auth-events') return 'audit.read';
  if (/^\/api\/v1\/report\/[^/]+\/llm$/.test(pathname)) return method === 'POST' ? 'assessment.write' : 'report.read';
  if (pathname.startsWith('/api/v1/report/')) return 'report.read';
  if (pathname === '/api/v1/projects') return method === 'POST' ? 'project.write' : 'business.read';
  if (/^\/api\/v1\/risks\/[^/]+\/config$/.test(pathname)) return 'risk.config.write';
  if (pathname.startsWith('/api/v1/projects/') || pathname.startsWith('/api/v1/graph/') || pathname.startsWith('/api/v1/evidence/') || pathname.startsWith('/api/v1/risks/') || pathname.startsWith('/api/v1/reviews/') || pathname.startsWith('/api/v1/followups/') || pathname.startsWith('/api/v1/tasks/')) {
    if (method === 'GET') return 'business.read';
    if (pathname.startsWith('/api/v1/reviews/')) return 'review.write';
    return 'assessment.write';
  }
  return 'authenticated';
}

module.exports = { ROLES, OPERATOR_SCOPES, ROLE_PERMISSIONS, hasPermission, permissionFor };
