'use strict';
const crypto = require('crypto');
const { MongoClient, ObjectId, Binary } = require('mongodb');

const G = global; G.__ks = G.__ks || {};
const httpErr = (status, message) => Object.assign(new Error(message), { status });
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const num = v => Math.max(0, Math.round(+v || 0));
const digits = v => String(v || '').replace(/\D/g, '');
const ip = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
const newId = () => 'p' + crypto.randomBytes(5).toString('hex');

/* ---------- MongoDB ---------- */
async function db() {
  if (!process.env.MONGODB_URI) throw httpErr(500, 'MONGODB_URI ကို Vercel Environment Variables ထဲ မထည့်ရသေးပါ');
  if (!G.__ks.p) {
    const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
    G.__ks.p = c.connect().then(async cl => {
      const d = cl.db(process.env.MONGODB_DB || 'kyawthu_store');
      await Promise.all([
        d.collection('rate').createIndex({ exp: 1 }, { expireAfterSeconds: 0 }),
        d.collection('orders').createIndex({ createdAt: -1 }),
        d.collection('products').createIndex({ createdAt: -1 })
      ]).catch(() => {});
      return d;
    }).catch(e => { G.__ks.p = null; throw httpErr(500, 'Database ချိတ်မရပါ: ' + e.message); });
  }
  return G.__ks.p;
}
// mongodb v6 returns the document; v5 returned { value, ok }
const unwrap = r => (r && typeof r === 'object' && 'value' in r && 'ok' in r ? r.value : r);

/* ---------- settings ---------- */
const DEFAULTS = {
  shopName: 'စိန်ဂေဟာ Store', tagline: 'Cash on Delivery ဈေးဝယ်စနစ်',
  heroTitle: 'လိုချင်သော ပစ္စည်းများကို အလွယ်တကူ ရွေးချယ် အော်ဒါတင်ပါ',
  heroText: 'အော်ဒါတင်သည်နှင့် ဆိုင်ရှင်ထံသို့ တိုက်ရိုက် အကြောင်းကြားစာ ရောက်ရှိမည်ဖြစ်ပါသည်။',
  announcement: '', closedMessage: 'ယခု ဆိုင်ပိတ်ထားပါသည်။ ခဏနေမှ ပြန်လာပါ။',
  telegramLink: '', viberNumber: '', phone: '',
  deliveryFee: 0, freeDeliveryOver: 0, shopOpen: true, tgChatId: ''
};
async function getSettings(d) {
  const s = (await d.collection('settings').findOne({ _id: 'main' })) || {};
  const { _id, ...rest } = s;
  return { ...DEFAULTS, ...rest };
}
const pubSettings = s => { const { tgChatId, ...p } = s; return p; };
function normTg(v) {
  v = str(v, 200);
  if (!v) return '';
  if (/^https?:\/\/(t|telegram)\.me\/\S+$/i.test(v)) return v;
  if (/^(t|telegram)\.me\/\S+$/i.test(v)) return 'https://' + v;
  const m = /^@?([A-Za-z0-9_]{4,32})$/.exec(v);
  return m ? 'https://t.me/' + m[1] : '';
}

/* ---------- admin auth (signed token) ---------- */
const secret = () => process.env.ADMIN_SECRET ||
  crypto.createHash('sha256').update('ks:' + (process.env.ADMIN_PASSWORD || '')).digest('hex');
const hmac = p => crypto.createHmac('sha256', secret()).update(p).digest('hex');
const sign = () => { const p = String(Date.now() + 7 * 864e5); return p + '.' + hmac(p); };
function verify(tok) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const [p, sig] = String(tok || '').split('.');
  if (!p || !sig || +p < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(hmac(p));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const bearer = req => String(req.headers.authorization || '').replace(/^Bearer /, '');
function same(a, b) {
  const x = v => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(x(a), x(b));
}

/* ---------- rate limit ---------- */
async function limit(d, key, max, sec) {
  const b = Math.floor(Date.now() / (sec * 1000));
  const r = unwrap(await d.collection('rate').findOneAndUpdate(
    { _id: key + ':' + b },
    { $inc: { n: 1 }, $setOnInsert: { exp: new Date((b + 2) * sec * 1000) } },
    { upsert: true, returnDocument: 'after' }));
  return !r || r.n <= max;
}

/* ---------- Telegram ---------- */
const ST = {
  Pending: '⏳ စောင့်ဆိုင်းဆဲ', Confirmed: '✅ အတည်ပြုပြီး', Delivering: '🚚 ပို့ဆောင်နေ',
  Completed: '🎉 ပြီးစီး', Rejected: '❌ ငြင်းပယ်'
};
const CODE = { c: 'Confirmed', d: 'Delivering', f: 'Completed', r: 'Rejected' };
const h = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const chatIds = s => String(s.tgChatId || process.env.TELEGRAM_CHAT_ID || '').split(/[,\s]+/).filter(Boolean);
const whSecret = () => crypto.createHash('sha256').update('wh:' + (process.env.TELEGRAM_BOT_TOKEN || '')).digest('hex').slice(0, 40);

async function tg(method, body) {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) return { ok: false, description: 'TELEGRAM_BOT_TOKEN မထည့်ရသေးပါ' };
  try {
    const r = await fetch('https://api.telegram.org/bot' + t + '/' + method, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {})
    });
    return await r.json();
  } catch (e) { return { ok: false, description: e.message }; }
}
function orderText(o) {
  const L = ['🛒 <b>အော်ဒါ ' + h(o._id) + '</b>', ST[o.status] || o.status, '',
    '👤 ' + h(o.customerName), '📞 ' + h(o.customerPhone), '📍 ' + h(o.customerAddress), ''];
  o.items.forEach(i => L.push('• ' + h(i.title) + ' × ' + i.qty + ' = ' + (i.price * i.qty).toLocaleString('en-US')));
  L.push('');
  if (o.deliveryFee) L.push('🚚 ပို့ခ: ' + o.deliveryFee.toLocaleString('en-US') + ' Ks');
  L.push('💰 <b>စုစုပေါင်း: ' + o.totalAmount.toLocaleString('en-US') + ' Ks</b> (COD)');
  if (o.note) L.push('📝 ' + h(o.note));
  if (o.adminNote) L.push('🗒 ' + h(o.adminNote));
  return L.join('\n');
}
function keyboard(o) {
  const b = (t, c) => ({ text: t, callback_data: 's:' + o._id + ':' + c });
  if (o.status === 'Pending') return [[b('✅ Confirm', 'c'), b('❌ Reject', 'r')]];
  if (o.status === 'Confirmed') return [[b('🚚 ပို့ဆောင်နေ', 'd'), b('🎉 ပြီးစီး', 'f')], [b('❌ Reject', 'r')]];
  if (o.status === 'Delivering') return [[b('🎉 ပြီးစီး', 'f'), b('❌ Reject', 'r')]];
  return [];
}
const msgBody = o => ({ text: orderText(o), parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard(o) } });
async function notifyNew(d, o, s) {
  const msgs = [];
  for (const id of chatIds(s)) {
    const r = await tg('sendMessage', { chat_id: id, ...msgBody(o) });
    if (r.ok) msgs.push({ chat: id, msg: r.result.message_id }); else console.error('telegram:', r.description);
  }
  if (msgs.length) await d.collection('orders').updateOne({ _id: o._id }, { $set: { tgMsgs: msgs } });
  return msgs.length;
}
async function refreshTg(o) {
  for (const m of o.tgMsgs || []) await tg('editMessageText', { chat_id: m.chat, message_id: m.msg, ...msgBody(o) });
}
async function setStatus(d, id, status, extra) {
  if (!ST[status]) throw httpErr(400, 'Status မမှန်ပါ');
  const o = unwrap(await d.collection('orders').findOneAndUpdate(
    { _id: id }, { $set: { status, updatedAt: new Date(), ...(extra || {}) } }, { returnDocument: 'after' }));
  if (!o) throw httpErr(404, 'အော်ဒါ မတွေ့ပါ');
  return o;
}

/* ---------- handler wrapper ---------- */
const wrap = fn => async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try { await fn(req, res); }
  catch (e) { console.error(e); res.status(e.status || 500).json({ error: e.message || 'Server error' }); }
};

module.exports = {
  db, unwrap, ObjectId, Binary, httpErr, str, num, digits, ip, newId, DEFAULTS, getSettings, pubSettings, normTg,
  sign, verify, bearer, same, limit, ST, CODE, chatIds, whSecret, tg, orderText, keyboard, msgBody,
  notifyNew, refreshTg, setStatus, wrap
};
