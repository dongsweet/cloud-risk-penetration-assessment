const test = require('node:test');
const assert = require('node:assert/strict');
const { hasPermission, permissionFor } = require('../app/lib/access-control');

const user = (roles, scopes = []) => ({ status: 'ACTIVE', roles, scopes });

test('role boundaries separate platform, account, business and audit permissions', () => {
  assert.equal(hasPermission(user([ 'SYSTEM_ADMIN' ]), 'system.config.write'), true);
  assert.equal(hasPermission(user([ 'SYSTEM_ADMIN' ]), 'users.admin'), false);
  assert.equal(hasPermission(user([ 'SYSTEM_ADMIN' ]), 'project.write'), true);
  assert.equal(hasPermission(user([ 'SECURITY_ADMIN' ]), 'users.admin'), true);
  assert.equal(hasPermission(user([ 'AUDITOR' ]), 'audit.read'), true);
  assert.equal(hasPermission(user([ 'AUDITOR' ]), 'assessment.write'), false);
  assert.equal(hasPermission(user([ 'AUDITOR' ]), 'project.write'), false);
  assert.equal(hasPermission(user([ 'OPERATOR' ], [ 'assess' ]), 'assessment.write'), true);
  assert.equal(hasPermission(user([ 'OPERATOR' ], [ 'assess' ]), 'project.write'), true);
  assert.equal(hasPermission(user([ 'OPERATOR' ], [ 'review' ]), 'project.write'), false);
  assert.equal(hasPermission(user([ 'OPERATOR' ], [ 'review' ]), 'review.write'), true);
  assert.equal(hasPermission(user([ 'OPERATOR' ], [ 'assess' ]), 'review.write'), false);
});

test('risk configuration has its own write permission', () => {
  assert.equal(permissionFor('PUT', '/api/v1/risks/PRJ-DEMO-001/config'), 'risk.config.write');
  assert.equal(permissionFor('POST', '/api/v1/risks/PRJ-DEMO-001/calculate'), 'assessment.write');
  assert.equal(permissionFor('POST', '/api/v1/projects'), 'project.write');
  assert.equal(permissionFor('GET', '/api/v1/auth-events'), 'audit.read');
});
