'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evidenceLabel, formatEvidenceReferences } = require('../app/lib/evidence-reference');

test('evidence references lead with a readable filename and retain the internal ID', () => {
  const id = 'EV-1793639157532-5ce5fe';
  assert.equal(evidenceLabel(id, '虚拟化组件清单.xlsx'), '虚拟化组件清单.xlsx（内部编号：EV-1793639157532-5ce5fe）');
  assert.equal(formatEvidenceReferences(`证据 ${id} 与当前图谱不一致`, [{ id, filename: '虚拟化组件清单.xlsx' }]), '证据 虚拟化组件清单.xlsx（内部编号：EV-1793639157532-5ce5fe） 与当前图谱不一致');
});

test('evidence reference formatting supports followups that predate filename display', () => {
  const evidence = [{ id: 'EV-1', filename: 'CMDB资产清单.csv' }, { id: 'EV-12', filename: '虚拟化组件清单.xlsx' }];
  assert.equal(formatEvidenceReferences('依据 EV-12 和 EV-1，请确认。', evidence), '依据 虚拟化组件清单.xlsx（内部编号：EV-12） 和 CMDB资产清单.csv（内部编号：EV-1），请确认。');
});
