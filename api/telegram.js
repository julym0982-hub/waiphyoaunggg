'use strict';
const { db, getSettings, chatIds, whSecret, tg, msgBody, setStatus, refreshTg, CODE, ST, wrap } = require('../lib/core');

async function onCallback(cb) {
  const chat = String((cb.message && cb.message.chat && cb.message.chat.id) || '');
  const d = await db();
  const s = await getSettings(d);
  const answer = (text, alert) => tg('answerCallbackQuery', { callback_query_id: cb.id, text, show_alert: !!alert });
  if (!chat || !chatIds(s).includes(chat)) return answer('ခွင့်ပြုချက် မရှိပါ', true);
  const m = /^s:([A-Z0-9-]+):([cdfr])$/.exec(cb.data || '');
  if (!m) return answer('မသိသော command');
  const status = CODE[m[2]];
  const cur = await d.collection('orders').findOne({ _id: m[1] });
  if (!cur) return answer('အော်ဒါ မတွေ့တော့ပါ (ဖျက်ထားနိုင်သည်)', true);
  if (cur.status === status) return answer(ST[status] + ' ဖြစ်ပြီးသား');
  const o = await setStatus(d, m[1], status, { by: 'telegram' });
  await answer(ST[status]);
  // update the clicked message (also works for /pending lists) + any saved copies
  await tg('editMessageText', { chat_id: chat, message_id: cb.message.message_id, ...msgBody(o) });
  await refreshTg({ ...o, tgMsgs: (o.tgMsgs || []).filter(x => !(x.chat === chat && x.msg === cb.message.message_id)) });
}

async function onMessage(m) {
  const chat = m.chat.id, t = String(m.text || '').trim();
  if (/^\/(start|id)\b/.test(t)) {
    return tg('sendMessage', {
      chat_id: chat, parse_mode: 'HTML',
      text: '👋 သင့် Chat ID: <code>' + chat + '</code>\n\nAdmin Panel → Settings → "Telegram Chat ID" ထဲ ဤနံပါတ်ကို ထည့်သိမ်းပါ။'
    });
  }
  if (/^\/pending\b/.test(t)) {
    const d = await db();
    if (!chatIds(await getSettings(d)).includes(String(chat))) return;
    const list = await d.collection('orders').find({ status: 'Pending' }).sort({ createdAt: -1 }).limit(10).toArray();
    if (!list.length) return tg('sendMessage', { chat_id: chat, text: 'စောင့်ဆိုင်းနေသော အော်ဒါ မရှိပါ ✅' });
    for (const o of list) await tg('sendMessage', { chat_id: chat, ...msgBody(o) });
  }
}

module.exports = wrap(async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('ok');
  if (req.headers['x-telegram-bot-api-secret-token'] !== whSecret()) return res.status(401).json({ error: 'forbidden' });
  const u = req.body || {};
  try {
    if (u.callback_query) await onCallback(u.callback_query);
    else if (u.message) await onMessage(u.message);
  } catch (e) { console.error('webhook', e); }
  res.status(200).json({ ok: true });
});
