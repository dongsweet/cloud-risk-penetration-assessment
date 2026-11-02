'use strict';

const RELATIONS = new Set([ '承载关系', '挂载关系', '部署关系', '调用关系', '网络可达关系', '权限关系', '共享资源关系', '隔离关系', '支撑关系', '组件关系', '归属关系', '隔离控制', '直接权限关系' ]);
const LAYERS = new Set([ 'platform', 'tenant', 'control' ]);
const TYPES = new Set([ 'host', 'virtualization', 'vm', 'container', 'application', 'database', 'business', 'account', 'resource_pool', 'security_control', 'storage', 'network', 'other' ]);
const FACTORS = [ 'C', 'N', 'P', 'R', 'E', 'B', 'I' ];

function activeValue(value) {
  if (value === undefined || value === null || value === '') return true;
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value;
  if ([ false, 0, '0', 'false', 'no', '否', '失效', 'inactive' ].includes(normalized)) return false;
  if ([ true, 1, '1', 'true', 'yes', '是', '有效', 'active' ].includes(normalized)) return true;
  throw new Error(`关系有效状态无效：${value}`);
}

function confidence(value, fallback = .75) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error('置信度必须是 0 到 1 之间的数');
  return n;
}

function parseCsv(input) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"' && quoted && input[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(v => v.trim())) rows.push(row);
  if (quoted) throw new Error('CSV 引号未闭合');
  if (rows.length < 2) throw new Error('CSV 至少需要一行表头和一行数据');
  const headers = rows.shift().map(h => h.trim().replace(/^\uFEFF/, '').toLowerCase());
  return rows.map(cells => Object.fromEntries(headers.map((h, i) => [ h, (cells[i] || '').trim() ])));
}

function normalize(data, source = '上传文件') {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('结构化证据必须是 JSON 对象');
  const assets = data.assets || data.nodes || [];
  const relations = data.relations || data.edges || [];
  const risks = data.risks || [];
  const questions = data.questions || [];
  if (![ assets, relations, risks, questions ].every(Array.isArray)) throw new Error('资产、关系、风险和追问字段必须为数组');
  const normalizedAssets = assets.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${i + 1} 个资产候选格式无效`);
    const id = String(item.id || item.asset_id || item.name || '').trim();
    if (!id) throw new Error(`第 ${i + 1} 个资产候选缺少标识`);
    if (!/^[\w.:/-]{1,100}$/.test(id)) throw new Error(`资产标识 ${id} 含有不允许的字符`);
    const layer = String(item.layer || 'tenant').toLowerCase();
    const type = String(item.type || item.asset_type || 'other').toLowerCase();
    if (!LAYERS.has(layer)) throw new Error(`资产 ${id} 的层级枚举无效`);
    if (!TYPES.has(type)) throw new Error(`资产 ${id} 的类型枚举无效`);
    return { ...item, id, name: String(item.name || item.asset_name || id), type, layer, source: String(item.source || source), confidence: confidence(item.confidence) };
  });
  const normalizedRelations = relations.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${i + 1} 个关系候选格式无效`);
    const from = String(item.from || item.source_id || item.source_asset_id || '').trim();
    const to = String(item.to || item.target_id || item.target_asset_id || '').trim();
    const relation = String(item.relation || item.relation_type || item.type || '').trim();
    if (!from || !to) throw new Error(`第 ${i + 1} 个关系候选缺少起点或终点`);
    if (!/^[\w.:/-]{1,100}$/.test(from) || !/^[\w.:/-]{1,100}$/.test(to)) throw new Error(`关系 ${i + 1} 的端点标识含有不允许的字符`);
    if (item.id && !/^[\w.:/-]{1,100}$/.test(String(item.id))) throw new Error(`关系 ${i + 1} 的标识含有不允许的字符`);
    if (!RELATIONS.has(relation)) throw new Error(`关系 ${relation || '(空)'} 不在允许的关系类型中`);
    const factors = {};
    for (const key of FACTORS) {
      const value = Number(item.factors?.[key] ?? .5);
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`关系 ${from} → ${to} 的因子 ${key} 超出 0 到 1 范围`);
      factors[key] = value;
    }
    return { ...item, from, to, relation, active: activeValue(item.active), source: String(item.source || source), confidence: confidence(item.confidence), factors };
  });
  const normalizedRisks = risks.map((item, i) => {
    const risk = typeof item === 'string' ? { name: item } : item;
    if (!risk || typeof risk !== 'object') throw new Error(`第 ${i + 1} 个风险候选格式无效`);
    const probability = Number(risk.probability ?? risk.likelihood ?? .3);
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error(`风险 ${risk.name || i + 1} 的发生可能性无效`);
    return { ...risk, name: String(risk.name || risk.risk_name || risk.type || '未命名风险'), source: String(risk.source || source), confidence: confidence(risk.confidence), probability };
  });
  const normalizedQuestions = questions.map(q => String(typeof q === 'string' ? q : q.question || q.text || '').trim()).filter(Boolean);
  return { assets: normalizedAssets, relations: normalizedRelations, risks: normalizedRisks, questions: normalizedQuestions };
}

function importStructured(text, ext, source) {
  if (ext === 'json') return normalize(JSON.parse(text), source);
  if (ext !== 'csv') return null;
  const rows = parseCsv(text);
  const headers = new Set(Object.keys(rows[0] || {}));
  const assets = [], relations = [], risks = [];
  for (const row of rows) {
    if (row.asset_id || row.asset_name) assets.push({ id: row.asset_id, name: row.asset_name, type: row.asset_type || 'other', layer: row.layer || 'tenant', tenant: row.tenant, pool: row.pool, source: row.source, confidence: row.confidence, value: row.value, importance: row.importance, sensitivity: row.sensitivity, impact: row.impact });
    if (row.source_asset_id && row.target_asset_id) relations.push({ from: row.source_asset_id, to: row.target_asset_id, relation: row.relation_type, active: row.active, source: row.source, confidence: row.confidence, factors: row.factors ? JSON.parse(row.factors) : undefined });
    if (row.risk_name || row.risk_type) risks.push({ node_id: row.node_id || row.asset_id, name: row.risk_name || row.risk_type, probability: row.probability, source: row.source, confidence: row.confidence });
  }
  if (!assets.length && !relations.length && !risks.length) throw new Error(`CSV 字段未匹配资产/关系/风险映射。已识别表头：${[ ...headers ].join(', ')}`);
  return normalize({ assets, relations, risks, questions: [] }, source);
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
  }
  return String(value).trim();
}

async function importExcel(file, source) {
  let ExcelJS;
  try { ExcelJS = require('exceljs'); } catch (_) { throw new Error('服务器未安装 Excel 导入组件，请重新构建 Docker 镜像'); }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const aliases = {
    assets: [ 'assets', 'nodes', '资产节点', '资产', '节点' ],
    relations: [ 'relations', 'edges', '关系边', '关系', '边' ],
    risks: [ 'risks', 'risk', '风险源', '风险' ]
  };
  const findSheet = names => workbook.worksheets.find(sheet => names.includes(String(sheet.name).trim().toLowerCase()));
  const headers = {
    asset_id: [ 'asset_id', 'id', '资产id', '资产标识', '节点id' ], asset_name: [ 'asset_name', 'name', '资产名称', '节点名称' ], asset_type: [ 'asset_type', 'type', '资产类型', '节点类型' ],
    layer: [ 'layer', '层级' ], tenant: [ 'tenant', '租户' ], pool: [ 'pool', '资源池' ], value: [ 'value', '资产价值' ], importance: [ 'importance', '业务重要性' ], sensitivity: [ 'sensitivity', '数据敏感度' ], availability: [ 'availability', '可用性' ], impact: [ 'impact', '影响程度' ], risk_name: [ 'risk_name', 'risk_type', '风险名称', '风险类型' ], probability: [ 'probability', 'likelihood', '发生概率' ], source: [ 'source', '来源' ], confidence: [ 'confidence', '置信度' ], description: [ 'description', '说明', '描述' ],
    edge_id: [ 'edge_id', '关系id', '边id' ], source_asset_id: [ 'source_asset_id', 'from', 'source_id', '起点资产id', '源资产id' ], target_asset_id: [ 'target_asset_id', 'to', 'target_id', '终点资产id', '目标资产id' ], relation_type: [ 'relation_type', 'relation', '关系类型' ], active: [ 'active', '有效', '是否有效' ], valid_from: [ 'valid_from', '生效时间' ], valid_to: [ 'valid_to', '失效时间' ], C: [ 'C', '承载强度' ], N: [ 'N', '网络可达' ], P: [ 'P', '权限关联' ], R: [ 'R', '共享资源' ], E: [ 'E', '跨层暴露' ], B: [ 'B', '业务耦合' ], I: [ 'I', '隔离有效' ], node_id: [ 'node_id', 'asset_id', '节点id', '资产id' ]
  };
  const canonical = (value, map) => { const key = cellText(value).trim().toLowerCase(); return Object.entries(map).find(([, values]) => values.some(item => String(item).toLowerCase() === key))?.[0]; };
  const readRows = sheet => {
    if (!sheet) return [];
    const raw = [];
    sheet.eachRow({ includeEmpty: false }, row => raw.push(row.values.slice(1).map(cellText)));
    if (raw.length < 2) return [];
    const mapped = raw[0].map(value => canonical(value, headers));
    return raw.slice(1).map(values => Object.fromEntries(mapped.map((key, i) => key ? [ key, values[i] || '' ] : null).filter(Boolean))).filter(row => Object.values(row).some(Boolean));
  };
  const assetRows = readRows(findSheet(aliases.assets));
  const relationRows = readRows(findSheet(aliases.relations));
  const riskRows = readRows(findSheet(aliases.risks));
  if (!assetRows.length && !relationRows.length && !riskRows.length) throw new Error('Excel 未找到可导入数据。请使用模板中的“资产节点”“关系边”“风险源”工作表和表头');
  const assets = assetRows.map(row => ({ ...row, id: row.asset_id, name: row.asset_name, type: row.asset_type }));
  const relations = relationRows.map(row => ({ ...row, id: row.edge_id, from: row.source_asset_id, to: row.target_asset_id, relation: row.relation_type, factors: Object.fromEntries(FACTORS.map(key => [ key, row[key] ])) }));
  const risks = riskRows.map(row => ({ ...row, node_id: row.node_id || row.asset_id, name: row.risk_name }));
  return normalize({ assets, relations, risks, questions: [] }, source);
}

module.exports = { normalize, parseCsv, importStructured, importExcel, RELATIONS, LAYERS, TYPES, FACTORS };
