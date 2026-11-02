'use strict';
module.exports = () => async (ctx, next) => {
  ctx.set('Access-Control-Allow-Origin', '*');
  ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  ctx.set('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  if (ctx.method === 'OPTIONS') { ctx.status = 204; return; }
  await next();
};
