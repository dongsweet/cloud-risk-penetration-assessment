const test = require('node:test');
const assert = require('node:assert/strict');
const { importStructured, normalize, parseCsv } = require('../app/lib/evidence');

test('CSV parser handles quoted commas and CRLF', () => {
  const rows = parseCsv('asset_id,asset_name\r\nA1,"业务,数据库"\r\n');
  assert.equal(rows[0].asset_name, '业务,数据库');
});

test('structured CSV evidence normalizes asset and relation records', () => {
  const csv = 'asset_id,asset_name,asset_type,layer,source_asset_id,target_asset_id,relation_type,active\nA1,数据库,database,tenant,,,\n,, , ,H1,A1,承载关系,false';
  const result = importStructured(csv, 'csv', 'fixture.csv');
  assert.equal(result.assets[0].id, 'A1');
  assert.equal(result.relations[0].active, false);
});

test('evidence validation rejects unsupported relation and invalid confidence', () => {
  assert.throws(() => normalize({ relations: [ { from: 'A', to: 'B', relation: '未知关系' } ] }), /关系/);
  assert.throws(() => normalize({ assets: [ { id: 'A', confidence: 2 } ] }), /置信度/);
});
