'use strict';
// စစ်ဆေးရန်: https://သင့်site.vercel.app/api/health
const { db, wrap } = require('../lib/core');
module.exports = wrap(async (req, res) => {
  const env = {
    MONGODB_URI: !!process.env.MONGODB_URI,
    ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD,
    TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN
  };
  let database = 'skipped';
  if (env.MONGODB_URI) { try { await db(); database = 'connected'; } catch (e) { database = 'FAILED: ' + e.message; } }
  res.status(200).json({ ok: true, node: process.version, env, database });
});
