'use strict';
const crypto = require('crypto');
const { db, httpErr, str, digits, ip, limit, getSettings, notifyNew, ST, wrap } = require('../lib/core');

const pub = o => ({
  id: o._id, status: o.status, statusText: ST[o.status], items: o.items, deliveryFee: o.deliveryFee,
  total: o.totalAmount, createdAt: o.createdAt, adminNote: o.adminNote || ''
});

module.exports = wrap(async (req, res) => {
  const d = await db();

  /* --- customer: track an order --- */
  if (req.method === 'GET') {
    const id = str(req.query.id, 30).toUpperCase();
    const ph = digits(req.query.phone);
    if (!id || ph.length < 6) throw httpErr(400, 'အော်ဒါနံပါတ်နှင့် ဖုန်းနံပါတ် ထည့်ပါ');
    if (!(await limit(d, 'trk:' + ip(req), 30, 600))) throw httpErr(429, 'ခဏနေမှ ပြန်ကြိုးစားပါ');
    const o = await d.collection('orders').findOne({ _id: id });
    if (!o || digits(o.customerPhone).slice(-7) !== ph.slice(-7)) throw httpErr(404, 'အော်ဒါ မတွေ့ပါ။ နံပါတ်ပြန်စစ်ပါ');
    return res.status(200).json({ order: pub(o) });
  }
  if (req.method !== 'POST') throw httpErr(405, 'Method not allowed');

  /* --- customer: place an order --- */
  const b = req.body || {};
  const name = str(b.name, 60), phone = str(b.phone, 20), address = str(b.address, 300), note = str(b.note, 300);
  if (!name || !address) throw httpErr(400, 'အမည်နှင့် လိပ်စာ ဖြည့်ပါ');
  if (!/^\+?[\d\s-]{7,18}$/.test(phone)) throw httpErr(400, 'ဖုန်းနံပါတ် မမှန်ပါ');
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) throw httpErr(400, 'ပစ္စည်း ရွေးချယ်ပါ');
  if (!(await limit(d, 'ord:' + ip(req), 5, 600))) throw httpErr(429, 'အော်ဒါ အကြိမ်များလွန်းသည်။ ခဏနေမှ ပြန်ကြိုးစားပါ');

  const s = await getSettings(d);
  if (!s.shopOpen) throw httpErr(403, s.closedMessage || 'ဆိုင်ပိတ်ထားပါသည်');

  const want = {};
  for (const i of b.items) {
    const q = Math.floor(+i.qty);
    if (!i || !i.id || !(q >= 1 && q <= 99)) throw httpErr(400, 'ပစ္စည်းအရေအတွက် မမှန်ပါ');
    want[String(i.id)] = (want[String(i.id)] || 0) + q;
  }
  const found = await d.collection('products').find({ _id: { $in: Object.keys(want) } }).toArray();
  const items = [];
  for (const id of Object.keys(want)) {
    const p = found.find(x => x._id === id);
    if (!p) throw httpErr(400, 'ပစ္စည်းတစ်ခု ဖယ်ရှားခံထားရသည်။ Page ကို refresh လုပ်ပါ');
    if (!p.inStock) throw httpErr(400, '"' + p.title + '" ကုန်သွားပါပြီ');
    const price = p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price;
    items.push({ id, title: p.title, price, qty: Math.min(99, want[id]) });
  }
  const subtotal = items.reduce((t, i) => t + i.price * i.qty, 0);
  const deliveryFee = s.freeDeliveryOver > 0 && subtotal >= s.freeDeliveryOver ? 0 : (s.deliveryFee || 0);
  const now = new Date();
  const order = {
    customerName: name, customerPhone: phone, customerAddress: address, note, items,
    subtotal, deliveryFee, totalAmount: subtotal + deliveryFee, status: 'Pending',
    adminNote: '', createdAt: now, updatedAt: now
  };
  for (let t = 0; ; t++) {
    order._id = 'ORD-' + crypto.randomInt(100000, 1000000);
    try { await d.collection('orders').insertOne(order); break; }
    catch (e) { if (e.code !== 11000 || t > 4) throw e; }
  }
  // Serverless: must finish Telegram call before responding (never block longer than 7s)
  let notified = 0;
  try {
    notified = await Promise.race([notifyNew(d, order, s), new Promise(r => setTimeout(() => r(0), 7000))]);
  } catch (e) { console.error('notify', e); }
  res.status(200).json({ ok: true, notified: !!notified, order: pub(order) });
});
