'use strict';
const {
  db, ObjectId, Binary, httpErr, str, num, ip, newId, getSettings, normTg, sign, verify, bearer, same, limit,
  chatIds, whSecret, tg, refreshTg, setStatus, wrap
} = require('../lib/core');

const mapP = x => ({
  id: x._id, title: x.title, price: x.price, salePrice: x.salePrice || 0, category: x.category,
  image: x.image || '', desc: x.desc || '', inStock: !!x.inStock
});
const mapO = ({ _id, tgMsgs, ...o }) => ({ id: _id, ...o });
const okImg = u => (/^(\/api\/image\?id=[a-f0-9]{24}|https?:\/\/\S+)$/.test(u) ? u : '');

async function dropImage(d, url) {
  const m = /^\/api\/image\?id=([a-f0-9]{24})$/.exec(url || '');
  if (m) await d.collection('images').deleteOne({ _id: new ObjectId(m[1]) });
}
const listOrders = d => d.collection('orders').find({}).sort({ createdAt: -1 }).limit(500).toArray();

module.exports = wrap(async (req, res) => {
  if (req.method !== 'POST') throw httpErr(405, 'POST only');
  const d = await db();
  const b = req.body || {};
  const a = b.action;
  const out = o => res.status(200).json(o);

  if (a === 'login') {
    if (!process.env.ADMIN_PASSWORD) throw httpErr(500, 'ADMIN_PASSWORD ကို Vercel Environment Variables ထဲ မထည့်ရသေးပါ');
    if (!(await limit(d, 'login:' + ip(req), 8, 600))) throw httpErr(429, 'မှားယွင်းမှု များလွန်းသည်။ ၁၀ မိနစ်စောင့်ပါ');
    if (!same(b.password || '', process.env.ADMIN_PASSWORD)) throw httpErr(401, 'Password မှားနေပါသည်');
    return out({ token: sign() });
  }
  if (!verify(bearer(req))) throw httpErr(401, 'Login ပြန်ဝင်ပါ');

  switch (a) {
    case 'bootstrap': {
      const [p, o, s] = await Promise.all([
        d.collection('products').find({}).sort({ createdAt: -1 }).toArray(), listOrders(d), getSettings(d)
      ]);
      return out({
        products: p.map(mapP), orders: o.map(mapO), settings: s,
        tg: { hasToken: !!process.env.TELEGRAM_BOT_TOKEN, envChat: !!process.env.TELEGRAM_CHAT_ID }
      });
    }
    case 'orders':
      return out({ orders: (await listOrders(d)).map(mapO) });

    case 'productSave': {
      const p = b.product || {};
      const price = Math.round(+p.price);
      const doc = {
        title: str(p.title, 100), category: str(p.category, 40) || 'အထွေထွေ', price,
        salePrice: num(p.salePrice), image: okImg(str(p.image, 500)), desc: str(p.desc, 500),
        inStock: !!p.inStock, updatedAt: new Date()
      };
      if (!doc.title || !(price >= 0)) throw httpErr(400, 'အမည်နှင့် ဈေးနှုန်း မှန်အောင် ဖြည့်ပါ');
      if (p.id) {
        const prev = await d.collection('products').findOne({ _id: String(p.id) });
        if (!prev) throw httpErr(404, 'ပစ္စည်း မတွေ့ပါ');
        await d.collection('products').updateOne({ _id: prev._id }, { $set: doc });
        if (prev.image && prev.image !== doc.image) await dropImage(d, prev.image);
      } else {
        await d.collection('products').insertOne({ _id: newId(), ...doc, createdAt: new Date() });
      }
      return out({ ok: true });
    }
    case 'productDelete': {
      const prev = await d.collection('products').findOne({ _id: String(b.id) });
      if (prev) { await d.collection('products').deleteOne({ _id: prev._id }); await dropImage(d, prev.image); }
      return out({ ok: true });
    }
    case 'productStock':
      await d.collection('products').updateOne({ _id: String(b.id) }, { $set: { inStock: !!b.inStock } });
      return out({ ok: true });

    case 'upload': {
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(b.dataUrl || '');
      if (!m) throw httpErr(400, 'ပုံ format မမှန်ပါ (jpg / png / webp)');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 2.5e6) throw httpErr(413, 'ပုံ ကြီးလွန်းသည် (2.5MB အောက်)');
      const r = await d.collection('images').insertOne({ type: m[1], data: new Binary(buf), createdAt: new Date() });
      return out({ url: '/api/image?id=' + r.insertedId });
    }
    case 'settingsSave': {
      const x = b.settings || {};
      const set = {
        shopName: str(x.shopName, 60) || 'My Store', tagline: str(x.tagline, 100), heroTitle: str(x.heroTitle, 150),
        heroText: str(x.heroText, 300), announcement: str(x.announcement, 200),
        closedMessage: str(x.closedMessage, 200), telegramLink: normTg(x.telegramLink),
        viberNumber: str(x.viberNumber, 20), phone: str(x.phone, 20),
        deliveryFee: num(x.deliveryFee), freeDeliveryOver: num(x.freeDeliveryOver), shopOpen: !!x.shopOpen,
        tgChatId: String(x.tgChatId || '').replace(/[^\d,\s-]/g, '').trim().slice(0, 100)
      };
      if (x.telegramLink && !set.telegramLink) throw httpErr(400, 'Telegram link မမှန်ပါ (ဥပမာ https://t.me/username)');
      await d.collection('settings').updateOne({ _id: 'main' }, { $set: set }, { upsert: true });
      return out({ ok: true, settings: await getSettings(d) });
    }
    case 'orderStatus': {
      const extra = typeof b.note === 'string' ? { adminNote: str(b.note, 300) } : {};
      const o = await setStatus(d, String(b.id), String(b.status), { ...extra, by: 'admin' });
      await refreshTg(o);
      return out({ order: mapO(o) });
    }
    case 'orderNote': {
      const r = await d.collection('orders').updateOne({ _id: String(b.id) }, { $set: { adminNote: str(b.note, 300) } });
      if (!r.matchedCount) throw httpErr(404, 'အော်ဒါ မတွေ့ပါ');
      const o = await d.collection('orders').findOne({ _id: String(b.id) });
      await refreshTg(o);
      return out({ ok: true });
    }
    case 'orderDelete':
      await d.collection('orders').deleteOne({ _id: String(b.id) });
      return out({ ok: true });
    case 'ordersClear': {
      const r = await d.collection('orders').deleteMany({ status: { $in: ['Completed', 'Rejected'] } });
      return out({ ok: true, deleted: r.deletedCount });
    }

    /* ---- Telegram tools ---- */
    case 'tgInfo': {
      if (!process.env.TELEGRAM_BOT_TOKEN) return out({ hasToken: false });
      const [me, wh] = await Promise.all([tg('getMe'), tg('getWebhookInfo')]);
      if (!me.ok) return out({ hasToken: true, error: me.description });
      return out({
        hasToken: true, bot: me.result.username, webhook: (wh.result && wh.result.url) || '',
        pending: wh.result && wh.result.pending_update_count, lastError: (wh.result && wh.result.last_error_message) || ''
      });
    }
    case 'tgSetup': {
      const me = await tg('getMe');
      if (!me.ok) throw httpErr(400, 'Bot token မမှန်ပါ: ' + me.description);
      const base = process.env.PUBLIC_URL || 'https://' + (req.headers['x-forwarded-host'] || req.headers.host);
      const url = base.replace(/\/$/, '') + '/api/telegram';
      const r = await tg('setWebhook', {
        url, secret_token: whSecret(), allowed_updates: ['message', 'callback_query'], drop_pending_updates: true
      });
      if (!r.ok) throw httpErr(400, 'Webhook ချိတ်မရပါ: ' + r.description);
      return out({ ok: true, bot: me.result.username, url });
    }
    case 'tgTest': {
      const ids = chatIds(await getSettings(d));
      if (!ids.length) throw httpErr(400, 'Chat ID မထည့်ရသေးပါ — Bot ကို Telegram မှာ /start လုပ်ပြီး ရလာသော ID ကို ထည့်သိမ်းပါ');
      let sent = 0, err = '';
      for (const id of ids) {
        const r = await tg('sendMessage', { chat_id: id, text: '✅ စမ်းသပ်စာ — Telegram အကြောင်းကြားစာ အလုပ်လုပ်နေပါပြီ။' });
        if (r.ok) sent++; else err = r.description;
      }
      if (!sent) throw httpErr(400, 'မပို့နိုင်ပါ: ' + err + ' (Bot ကို /start လုပ်ထားလား စစ်ပါ)');
      return out({ ok: true, sent });
    }
    default:
      throw httpErr(400, 'Unknown action');
  }
});
