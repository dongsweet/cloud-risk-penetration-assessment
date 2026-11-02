'use strict';

const path = require('path');

module.exports = appInfo => {
  const config = exports = {};
  config.keys = process.env.APP_KEYS || 'local-development-only-change-this-to-a-random-32-character-key';
  config.logger = { level: 'INFO' };
  config.server = { port: Number(process.env.PORT || 7001), hostname: '0.0.0.0' };
  config.cluster = { listen: { port: Number(process.env.PORT || 7001), hostname: '0.0.0.0' } };
  config.middleware = [ 'errorHandler', 'authorize' ];
  config.static = { prefix: '/', dir: path.join(appInfo.baseDir, 'public'), gzip: true };
  config.multipart = {
    mode: 'file',
    fileSize: '20mb',
    cleanSchedule: { cron: '0 0 * * * *' },
    whitelist: [ '.txt', '.csv', '.json', '.md', '.docx', '.pdf' ],
    tmpdir: path.join(appInfo.baseDir, 'data', 'tmp')
  };
  config.security = { csrf: { enable: false } };
  config.bodyParser = { jsonLimit: '2mb', formLimit: '2mb' };
  config.onerror = { all(err, ctx) { ctx.status = err.status || 500; ctx.body = { ok: false, error: err.message }; } };
  return config;
};
