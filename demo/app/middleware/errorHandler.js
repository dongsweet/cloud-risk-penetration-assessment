'use strict';
module.exports = () => async (ctx, next) => {
  try { await next(); } catch (err) {
    ctx.app.emit('error', err, ctx);
    ctx.status = err.status || 500;
    ctx.body = { ok: false, error: err.message };
  }
};
