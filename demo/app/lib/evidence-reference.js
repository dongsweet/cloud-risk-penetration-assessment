'use strict';

function evidenceLabel(evidenceId, filename) {
  return filename ? `${filename}（内部编号：${evidenceId}）` : evidenceId;
}

function formatEvidenceReferences(text, evidenceItems = []) {
  if (text === null || text === undefined) return text;
  const formatted = String(text);
  const references = (evidenceItems || [])
    .filter(item => item?.id && item?.filename)
    .sort((a, b) => String(b.id).length - String(a.id).length);
  if (!references.length) return formatted;
  const names = new Map(references.map(item => [ item.id, item.filename ]));
  const pattern = references.map(item => String(item.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return formatted.replace(new RegExp(pattern, 'g'), id => evidenceLabel(id, names.get(id)));
}

module.exports = { evidenceLabel, formatEvidenceReferences };
