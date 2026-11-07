'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('en-US') + ' Ks';
const NOPIC = 'https://placehold.co/400x300/e2e8f0/64748b?text=No+Photo';
const priceOf = p => (p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price);
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

let products = [], settings = {}, cat = 'All', cart = lsGet('ks_cart', []), lastOrder = lsGet('ks_last', null);

async function init() {
  try {
    const r = await fetch('/api/shop');
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'error');
    products = d.products; settings = d.settings;
  } catch (e) {
    $('productGrid').innerHTML = '<div class="col-span-full text-center py-12 text-rose-500 text-sm">ဆာဗာနှင့် ချိတ်ဆက်မရပါ။ Page ကို ပြန် refresh လုပ်ပါ။<br><span class="text-xs text-slate-400">' + esc(e.message) + '</span></div>';
    return;
  }
  // drop cart lines whose product vanished / sold out
  cart = cart.filter(i => products.some(p => p.id === i.id && p.inStock) && i.qty > 0);
  applySettings(); renderCats(); renderProducts(); saveCart();
}

function applySettings() {
  const s = settings;
  document.title = s.shopName || 'Store';
  $('brandName').textContent = s.shopName || 'Store';
  $('brandTag').textContent = s.tagline || '';
  $('heroTitle').textContent = s.heroTitle || '';
  $('heroText').textContent = s.heroText || '';
  $('footerText').textContent = '© ' + new Date().getFullYear() + ' ' + (s.shopName || '');
  const tgBtn = $('tgBtn');
  if (s.telegramLink) { tgBtn.href = s.telegramLink; tgBtn.classList.remove('hidden'); tgBtn.classList.add('flex'); }
  const bar = $('noticeBar');
  if (!s.shopOpen) {
    bar.className = 'bg-rose-600 text-white text-center text-sm font-bold py-2 px-4';
    bar.textContent = '🔒 ' + (s.closedMessage || 'ဆိုင်ပိတ်ထားပါသည်');
  } else if (s.announcement) {
    bar.className = 'bg-amber-100 text-amber-900 text-center text-sm font-semibold py-2 px-4';
    bar.textContent = '📢 ' + s.announcement;
  } else bar.className = 'hidden';
}

/* ---------- catalog ---------- */
function renderCats() {
  const cats = ['All', ...new Set(products.map(p => p.category))];
  $('categoryFilters').innerHTML = cats.map(c =>
    '<button data-cat="' + esc(c) + '" class="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition ' +
    (cat === c ? 'bg-sky-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200') + '">' +
    (c === 'All' ? 'အားလုံး' : esc(c)) + '</button>').join('');
  $('categoryFilters').querySelectorAll('button').forEach(b => b.onclick = () => { cat = b.dataset.cat; renderCats(); renderProducts(); });
}

function renderProducts() {
  const q = $('searchInput').value.toLowerCase();
  const list = products.filter(p => (cat === 'All' || p.category === cat) &&
    (p.title.toLowerCase().includes(q) || (p.desc || '').toLowerCase().includes(q)));
  if (!list.length) {
    $('productGrid').innerHTML = '<div class="col-span-full text-center py-12 text-slate-400"><i class="fa-solid fa-box-open text-4xl mb-2"></i><p class="text-sm">ပစ္စည်း မရှိသေးပါ။</p></div>';
    return;
  }
  $('productGrid').innerHTML = list.map(p => {
    const sale = priceOf(p) < p.price;
    return '<div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition flex flex-col group">' +
      '<div class="relative h-44 bg-slate-100 overflow-hidden"><img loading="lazy" src="' + esc(p.image || NOPIC) + '" alt="' + esc(p.title) + '" onerror="this.onerror=null;this.src=\'' + NOPIC + '\'" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">' +
      '<span class="absolute top-2 right-2 text-[10px] px-2.5 py-1 rounded-full font-bold shadow-sm ' + (p.inStock ? 'bg-emerald-500' : 'bg-rose-500') + ' text-white">' + (p.inStock ? 'Stock ရှိသည်' : 'ကုန်နေသည်') + '</span>' +
      (sale ? '<span class="absolute top-2 left-2 text-[10px] px-2.5 py-1 rounded-full font-bold bg-amber-500 text-white shadow-sm">လျှော့ဈေး</span>' : '') + '</div>' +
      '<div class="p-4 flex-1 flex flex-col justify-between space-y-3"><div>' +
      '<span class="text-[10px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-md">' + esc(p.category) + '</span>' +
      '<h4 class="font-bold text-slate-800 text-sm mt-1 line-clamp-1">' + esc(p.title) + '</h4>' +
      '<p class="text-xs text-slate-500 line-clamp-2 mt-1">' + esc(p.desc || '') + '</p></div>' +
      '<div class="pt-2 border-t border-slate-100 flex items-center justify-between"><div>' +
      (sale ? '<span class="text-xs text-slate-400 line-through block">' + fmt(p.price) + '</span>' : '<span class="text-xs text-slate-400 block">ဈေးနှုန်း</span>') +
      '<span class="text-base font-bold ' + (sale ? 'text-amber-600' : 'text-slate-900') + '">' + fmt(priceOf(p)) + '</span></div>' +
      '<button onclick="addToCart(\'' + esc(p.id) + '\')" ' + (p.inStock ? '' : 'disabled') + ' class="p-2.5 rounded-xl text-xs font-bold transition ' +
      (p.inStock ? 'bg-sky-600 hover:bg-sky-700 text-white shadow-sm' : 'bg-slate-200 text-slate-400 cursor-not-allowed') + '"><i class="fa-solid fa-cart-plus text-base"></i></button>' +
      '</div></div></div>';
  }).join('');
}

/* ---------- cart ---------- */
function saveCart() {
  lsSet('ks_cart', cart);
  $('cartBadge').textContent = cart.reduce((t, i) => t + i.qty, 0);
}
function addToCart(id) {
  const p = products.find(x => x.id === id);
  if (!p || !p.inStock) return;
  const l = cart.find(i => i.id === id);
  if (l) l.qty = Math.min(99, l.qty + 1); else cart.push({ id, qty: 1 });
  saveCart(); toggleCartModal(true);
}
function updateCartQty(id, d) {
  const l = cart.find(i => i.id === id);
  if (!l) return;
  l.qty += d;
  if (l.qty <= 0) cart = cart.filter(i => i.id !== id);
  if (l.qty > 99) l.qty = 99;
  saveCart(); renderCart();
}
function toggleCartModal(show) {
  const m = $('cartModal');
  if (show === true) m.classList.remove('hidden'); else if (show === false) m.classList.add('hidden'); else m.classList.toggle('hidden');
  if (!m.classList.contains('hidden')) renderCart();
}
function totals() {
  const sub = cart.reduce((t, i) => { const p = products.find(x => x.id === i.id); return t + (p ? priceOf(p) * i.qty : 0); }, 0);
  const free = settings.freeDeliveryOver > 0 && sub >= settings.freeDeliveryOver;
  const fee = !cart.length || free ? 0 : (settings.deliveryFee || 0);
  return { sub, fee, total: sub + fee, free };
}
function renderCart() {
  const c = $('cartItemsList');
  if (!cart.length) {
    c.innerHTML = '<div class="text-center py-12 text-slate-400"><i class="fa-solid fa-basket-shopping text-4xl mb-2"></i><p class="text-sm">ဈေးဝယ်ခြင်းထဲတွင် ပစ္စည်းမရှိသေးပါ။</p></div>';
  } else {
    c.innerHTML = cart.map(i => {
      const p = products.find(x => x.id === i.id); if (!p) return '';
      return '<div class="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-100"><div class="flex items-center gap-3">' +
        '<img src="' + esc(p.image || NOPIC) + '" onerror="this.onerror=null;this.src=\'' + NOPIC + '\'" class="w-12 h-12 rounded-lg object-cover bg-white">' +
        '<div><h5 class="text-xs font-bold text-slate-800 line-clamp-1">' + esc(p.title) + '</h5><p class="text-xs text-sky-600 font-semibold">' + fmt(priceOf(p)) + '</p></div></div>' +
        '<div class="flex items-center gap-2 bg-white px-2 py-1 rounded-lg border border-slate-200">' +
        '<button onclick="updateCartQty(\'' + esc(i.id) + '\',-1)" class="text-slate-500 hover:text-slate-800 text-sm px-2 font-bold">-</button>' +
        '<span class="text-xs font-bold w-5 text-center">' + i.qty + '</span>' +
        '<button onclick="updateCartQty(\'' + esc(i.id) + '\',1)" class="text-slate-500 hover:text-slate-800 text-sm px-2 font-bold">+</button></div></div>';
    }).join('');
  }
  const t = totals();
  $('cartSubtotal').textContent = fmt(t.sub);
  $('cartDelivery').textContent = t.free ? 'အခမဲ့ 🎉' : fmt(t.fee);
  $('cartTotalAmount').textContent = fmt(t.total);
}

/* ---------- order ---------- */
async function handlePlaceOrder(e) {
  e.preventDefault();
  if (!cart.length) return alert('ကျေးဇူးပြု၍ ပစ္စည်း အရင်ရွေးချယ်ပါ။');
  if (!settings.shopOpen) return alert(settings.closedMessage || 'ဆိုင်ပိတ်ထားပါသည်');
  const btn = $('orderSubmit'); btn.disabled = true; btn.classList.add('opacity-60');
  try {
    const r = await fetch('/api/order', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: $('custName').value, phone: $('custPhone').value, address: $('custAddress').value,
        note: $('custNote').value, items: cart.map(i => ({ id: i.id, qty: i.qty }))
      })
    });
    const d = await r.json();
    if (!r.ok) { if (r.status === 400) init(); throw new Error(d.error || 'အော်ဒါ မအောင်မြင်ပါ'); }
    lastOrder = { id: d.order.id, phone: $('custPhone').value };
    lsSet('ks_last', lastOrder);
    cart = []; saveCart();
    $('orderForm').reset(); toggleCartModal(false);
    showReceipt(d.order, $('custName').value);
  } catch (err) { alert('⚠️ ' + err.message); }
  btn.disabled = false; btn.classList.remove('opacity-60');
}

function showReceipt(o) {
  $('receiptContent').innerHTML =
    '<p><strong>အော်ဒါနံပါတ်:</strong> <span class="text-sky-600 font-bold">' + esc(o.id) + '</span></p>' +
    '<p><strong>မှာယူသော ပစ္စည်းများ:</strong> ' + o.items.map(i => esc(i.title) + ' (' + i.qty + ' ခု)').join(', ') + '</p>' +
    (o.deliveryFee ? '<p><strong>ပို့ခ:</strong> ' + fmt(o.deliveryFee) + '</p>' : '') +
    '<p class="text-sm font-bold text-slate-900 pt-1 border-t border-slate-200 mt-1">ကျသင့်ငွေ: ' + fmt(o.total) + ' (Cash on Delivery)</p>' +
    '<p class="text-[11px] text-slate-400">အော်ဒါနံပါတ်ကို မှတ်ထားပါ — "အော်ဒါစစ်ရန်" ခလုတ်မှ အခြေအနေ ကြည့်နိုင်ပါသည်။</p>';
  const s = settings, b = [];
  if (s.telegramLink) b.push('<a href="' + esc(s.telegramLink) + '" target="_blank" rel="noopener" class="flex items-center justify-center gap-2 py-2.5 px-3 bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold rounded-lg"><i class="fa-brands fa-telegram text-base"></i> Telegram ဖြင့် ဆက်သွယ်မည်</a>');
  if (s.viberNumber) b.push('<a href="viber://chat?number=' + encodeURIComponent(s.viberNumber) + '" class="flex items-center justify-center gap-2 py-2.5 px-3 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg"><i class="fa-brands fa-viber text-base"></i> Viber</a>');
  if (s.phone) b.push('<a href="tel:' + esc(s.phone) + '" class="flex items-center justify-center gap-2 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg"><i class="fa-solid fa-phone"></i> ' + esc(s.phone) + '</a>');
  $('contactBtns').innerHTML = b.join('');
  $('contactBox').classList.toggle('hidden', !b.length);
  $('orderSuccessModal').classList.remove('hidden');
}
function closeSuccessModal() { $('orderSuccessModal').classList.add('hidden'); }

/* ---------- track ---------- */
function openTrack() {
  if (lastOrder) { $('trkId').value = lastOrder.id; $('trkPhone').value = lastOrder.phone; }
  $('trkResult').innerHTML = ''; $('trackModal').classList.remove('hidden');
}
function closeTrack() { $('trackModal').classList.add('hidden'); }
async function doTrack(e) {
  e.preventDefault();
  const box = $('trkResult'); box.innerHTML = '<p class="text-slate-400">စစ်ဆေးနေပါသည်...</p>';
  try {
    const r = await fetch('/api/order?id=' + encodeURIComponent($('trkId').value) + '&phone=' + encodeURIComponent($('trkPhone').value));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    const o = d.order;
    box.innerHTML = '<div class="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1">' +
      '<p class="font-bold text-slate-800">' + esc(o.id) + '</p>' +
      '<p class="text-base font-bold">' + esc(o.statusText) + '</p>' +
      '<p class="text-xs text-slate-500">' + o.items.map(i => esc(i.title) + ' × ' + i.qty).join(', ') + '</p>' +
      '<p class="text-xs font-bold">' + fmt(o.total) + '</p>' +
      (o.adminNote ? '<p class="text-xs text-amber-700">🗒 ' + esc(o.adminNote) + '</p>' : '') + '</div>';
  } catch (err) { box.innerHTML = '<p class="text-rose-500">' + esc(err.message) + '</p>'; }
}

document.addEventListener('DOMContentLoaded', () => {
  $('searchInput').addEventListener('input', renderProducts);
  saveCart(); init();
});
