/* Customer website: catalogue, order basket, custom file quote, order lookup. */
(() => {
'use strict';
const C = window.FC_CONFIG || {};
const BRAND = C.BRAND || {};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eur = n => new Intl.NumberFormat('en-GB', {style: 'currency', currency: 'EUR'}).format(+n || 0);

const configured = C.SUPABASE_URL && C.SUPABASE_ANON_KEY && !/YOUR-/.test(C.SUPABASE_URL + C.SUPABASE_ANON_KEY);
const sb = configured && window.supabase ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;

const STAGE_TEXT = {
  new: ['Received', 'We have your order and will confirm it shortly.'],
  quote: ['Quote sent', 'We have sent you a price. Reply to us if you would like to go ahead.'],
  accepted: ['Accepted', 'Your order is confirmed and waiting in the print queue.'],
  printing: ['Printing', 'Your order is on the printer now.'],
  ready: ['Ready to collect', 'Your order is finished and ready.'],
  collected: ['Collected', 'This order has been collected. Thank you.'],
  declined: ['Closed', 'This request was closed. Get in touch if you have questions.']
};

let products = [];
let cart = [];
let lastFocus = null, toastTimer = null;
try { cart = JSON.parse(localStorage.getItem('fc-cart') || '[]').filter(l => l && l.product_id); } catch (e) { cart = []; }
const saveCart = () => { try { localStorage.setItem('fc-cart', JSON.stringify(cart)); } catch (e) {} };

/* ---------- small helpers ---------- */
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
function openModal(html, narrow) {
  lastFocus = document.activeElement;
  const p = $('#panel'); p.className = 'panel' + (narrow ? ' narrow' : ''); p.innerHTML = html;
  $('#modal').hidden = false; document.documentElement.style.overflow = 'hidden';
  const f = p.querySelector('input:not([type=hidden]):not(.hp input),select,textarea,button.primary'); if (f) f.focus();
}
function closeModal() {
  $('#modal').hidden = true; $('#panel').innerHTML = ''; document.documentElement.style.overflow = '';
  if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
}
const imgUrl = p => !p.image_path ? '' : /^assets\//.test(p.image_path) ? p.image_path : (sb ? sb.storage.from('product-images').getPublicUrl(p.image_path).data.publicUrl : '');
const thumb = p => { const u = imgUrl(p); return u ? '<div class="thumb"><img src="' + esc(u) + '" alt="' + esc(p.name) + '" loading="lazy"></div>' : '<div class="thumb ph" role="img" aria-label="No photo yet"></div>'; };
const arr = v => Array.isArray(v) ? v : [];
const extraFor = (p, name) => { const m = arr(p.materials).find(x => x.name === name); return m ? (+m.extra || 0) : 0; };
const cartCount = () => cart.reduce((s, l) => s + l.qty, 0);
const cartTotal = () => cart.reduce((s, l) => s + l.unit * l.qty, 0);
function updateCartBadge() { $('#cartN').textContent = cartCount(); }
function friendly(e) { return (e && e.message && e.message.length < 160) ? e.message : 'Something went wrong. Please try again in a moment.'; }

/* ---------- recent prints gallery (from config.js) ---------- */
function renderGallery() {
  const items = arr(C.GALLERY).filter(g => g && g.image);
  const sec = $('#gallery');
  if (!items.length) { sec.hidden = true; return; }
  $('#galleryGrid').innerHTML = items.map(g =>
    '<figure class="shot"><img src="' + esc(g.image) + '" width="' + (+g.width || 800) + '" height="' + (+g.height || 600) + '" alt="' + esc(g.title || '') + '" loading="lazy">' +
    '<figcaption><strong>' + esc(g.title || '') + '</strong>' + (g.text ? '<span>' + esc(g.text) + '</span>' : '') + '</figcaption></figure>').join('');
  sec.hidden = false;
}

/* ---------- catalogue ---------- */
function renderProducts() {
  const el = $('#products');
  if (!products.length) { el.innerHTML = '<p class="empty">The catalogue is being set up. In the meantime you can send us your own file below.</p>'; return; }
  el.innerHTML = products.map(p => {
    const hasExtra = arr(p.materials).some(m => +m.extra > 0);
    return '<button type="button" class="pcard" data-act="product" data-id="' + esc(p.id) + '">' + thumb(p) +
      '<span class="pinfo"><h3>' + esc(p.name) + '</h3>' + (p.description ? '<p>' + esc(p.description) + '</p>' : '') +
      '<span class="price">' + (hasExtra ? 'from ' : '') + eur(p.price) + '</span></span></button>';
  }).join('');
}
async function loadProducts() {
  if (!sb) { $('#products').innerHTML = ''; return; }
  const {data, error} = await sb.from('products').select('*').eq('active', true).order('sort').order('name');
  if (error) { $('#products').innerHTML = '<p class="empty">We could not load the catalogue just now. Please refresh the page.</p>'; return; }
  products = data || [];
  renderProducts();
}

function openProduct(id) {
  const p = products.find(x => x.id === id); if (!p) return;
  const mats = arr(p.materials), cols = arr(p.colours);
  const html = '<div class="panel-head"><h2 id="panelTitle">' + esc(p.name) + '</h2><button class="btn small quiet" type="button" data-act="close">Close</button></div>' +
    '<div class="panel-body"><div class="pm-top">' + thumb(p) +
    '<form class="pm-form" id="pmForm" data-id="' + esc(p.id) + '" novalidate>' +
    (p.description ? '<p>' + esc(p.description) + '</p>' : '') +
    (mats.length ? '<label class="field"><span>Material</span><select name="material">' + mats.map(m => '<option value="' + esc(m.name) + '">' + esc(m.name) + (+m.extra > 0 ? ' (+' + eur(m.extra) + ')' : '') + '</option>').join('') + '</select></label>' : '') +
    (cols.length ? '<label class="field"><span>Colour</span><select name="colour">' + cols.map(c => '<option>' + esc(c) + '</option>').join('') + '</select></label>' : '') +
    '<label class="field"><span>Quantity</span><input type="number" name="qty" min="1" max="500" step="1" value="1" inputmode="numeric"></label>' +
    '<p class="pm-price" id="pmPrice"></p>' +
    '<button class="btn primary" type="submit">Add to your order</button></form></div></div>';
  openModal(html); updatePm();
}
function pmValues() {
  const f = $('#pmForm'); if (!f) return null;
  const p = products.find(x => x.id === f.dataset.id); if (!p) return null;
  const fd = new FormData(f), material = String(fd.get('material') || ''), colour = String(fd.get('colour') || '');
  const qty = Math.min(500, Math.max(1, Math.round(parseFloat(fd.get('qty'))) || 1));
  return {p, material, colour, qty, unit: (+p.price || 0) + extraFor(p, material)};
}
function updatePm() {
  const v = pmValues(); if (!v) return;
  $('#pmPrice').textContent = eur(v.unit) + ' each' + (v.qty > 1 ? ' · ' + eur(v.unit * v.qty) + ' total' : '');
}
function addToCart() {
  const v = pmValues(); if (!v) return;
  const key = [v.p.id, v.material, v.colour].join('|');
  const ex = cart.find(l => l.key === key);
  if (ex) ex.qty = Math.min(500, ex.qty + v.qty);
  else cart.push({key, product_id: v.p.id, name: v.p.name, qty: v.qty, material: v.material, colour: v.colour, unit: v.unit});
  saveCart(); updateCartBadge(); closeModal(); toast('Added to your order');
}

/* ---------- basket and checkout ---------- */
function linesHtml() {
  if (!cart.length) return '<p class="muted" style="padding:12px">Your order is empty. Pick something from the catalogue first.</p>';
  return cart.map(l => '<div class="line"><div><div class="nm">' + esc(l.name) + '</div><div class="sub">' + esc([l.material, l.colour].filter(Boolean).join(' · ')) + ' · ' + eur(l.unit) + ' each</div></div>' +
    '<div class="qty"><button class="btn small" type="button" data-act="dec" data-key="' + esc(l.key) + '" aria-label="Less">−</button><span class="mono">' + l.qty + '</span><button class="btn small" type="button" data-act="inc" data-key="' + esc(l.key) + '" aria-label="More">+</button>' +
    '<button class="btn small quiet" type="button" data-act="rm" data-key="' + esc(l.key) + '">Remove</button></div></div>').join('');
}
function refreshCart() {
  const l = $('#cartLines'); if (!l) return;
  l.innerHTML = linesHtml(); $('#cartTotal').textContent = eur(cartTotal());
  const b = $('#placeBtn'); if (b) b.disabled = !cart.length;
}
function openCart() {
  openModal('<form id="orderForm" novalidate><div class="panel-head"><h2 id="panelTitle">Your order</h2><button class="btn small quiet" type="button" data-act="close">Close</button></div>' +
    '<div class="panel-body"><div class="lines" id="cartLines"></div>' +
    '<div class="total"><span>Estimated total</span><span class="mono" id="cartTotal"></span></div>' +
    '<p class="sub">We confirm the final price and the date with you before we start printing.</p>' +
    '<div class="block"><h3>Your details</h3><div class="grid2">' +
    '<label class="field"><span>Name *</span><input name="customer" autocomplete="name"></label>' +
    '<label class="field"><span>Email or phone *</span><input name="contact" autocomplete="email"></label></div>' +
    '<div class="radios" role="radiogroup" aria-label="Collection or delivery"><label><input type="radio" name="delivery" value="collect" checked> Collect from us</label><label><input type="radio" name="delivery" value="delivery"> Delivery (we confirm the cost)</label></div>' +
    '<label class="field"><span>Anything we should know?</span><textarea name="notes"></textarea></label>' +
    '<div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div></div></div>' +
    '<div class="panel-foot"><span class="err" id="formErr" role="alert"></span><span class="spacer"></span><button class="btn primary" type="submit" id="placeBtn">Place order</button></div></form>');
  refreshCart();
}
function doneInner(ref, total, custom) {
  return '<p>' + (custom ? 'Thank you. We have your file and will reply with a price.' : 'Thank you. We have your order and will confirm it with you shortly.') + '</p>' +
    '<span class="ref">' + esc(ref) + '</span><p class="muted">Keep this reference. You can use it with your email or phone number to check progress.' + (total != null ? ' Estimated total: ' + eur(total) + '.' : '') + '</p>';
}
function successHtml(ref, total) {
  return '<div class="panel-head"><h2 id="panelTitle">Order received</h2><button class="btn small quiet" type="button" data-act="close">Close</button></div>' +
    '<div class="panel-body"><div class="done">' + doneInner(ref, total, false) + '</div></div>';
}
async function submitOrder(f) {
  const err = $('#formErr'), btn = $('#placeBtn');
  if (!sb) { err.textContent = 'This site is not connected yet.'; return; }
  if (!cart.length) { err.textContent = 'Your order is empty.'; return; }
  const fd = new FormData(f), v = n => String(fd.get(n) || '').trim();
  if (!v('customer') || v('contact').length < 3) { err.textContent = 'Please enter your name and an email address or phone number.'; return; }
  err.textContent = ''; btn.disabled = true; btn.textContent = 'Sending…';
  const payload = {customer: v('customer'), contact: v('contact'), delivery: v('delivery') || 'collect', notes: v('notes'), website: v('website'),
    lines: cart.map(l => ({product_id: l.product_id, qty: l.qty, material: l.material, colour: l.colour}))};
  const {data, error} = await sb.rpc('place_order', {p: payload});
  if (error) { err.textContent = friendly(error); btn.disabled = false; btn.textContent = 'Place order'; return; }
  cart = []; saveCart(); updateCartBadge();
  $('#panel').innerHTML = successHtml(data.ref, data.total);
}

/* ---------- custom file quote ---------- */
function renderCustom(msg) {
  const box = $('#customBox');
  if (msg) { box.innerHTML = '<div class="done">' + doneInner(msg.ref, null, true) + '<button class="btn" type="button" data-act="another">Send another file</button></div>'; return; }
  const mats = (C.CUSTOM_MATERIALS && C.CUSTOM_MATERIALS.length ? C.CUSTOM_MATERIALS : ['PLA']);
  box.innerHTML = '<form id="customForm" novalidate>' +
    '<div class="block"><label class="field"><span>Model file (.stl, .3mf or .obj, up to ' + (C.MAX_STL_MB || 50) + ' MB) *</span><input type="file" name="file" accept=".stl,.3mf,.obj"></label>' +
    '<div class="grid3"><label class="field"><span>Material</span><select name="material">' + mats.map(m => '<option>' + esc(m) + '</option>').join('') + '</select></label>' +
    '<label class="field"><span>Colour</span><input name="colour" placeholder="e.g. black"></label>' +
    '<label class="field"><span>Quantity</span><input type="number" name="qty" min="1" max="500" step="1" value="1" inputmode="numeric"></label></div>' +
    '<label class="field"><span>Size, purpose or anything else we should know</span><textarea name="note"></textarea></label>' +
    '<div class="grid2"><label class="field"><span>Name *</span><input name="customer" autocomplete="name"></label>' +
    '<label class="field"><span>Email or phone *</span><input name="contact" autocomplete="email"></label></div>' +
    '<div class="radios" role="radiogroup" aria-label="Collection or delivery"><label><input type="radio" name="delivery" value="collect" checked> Collect from us</label><label><input type="radio" name="delivery" value="delivery"> Delivery (we confirm the cost)</label></div>' +
    '<div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>' +
    '<div><button class="btn primary" type="submit" id="customBtn">Request a quote</button> <span class="err" id="customErr" role="alert"></span></div></div></form>';
}
async function submitCustom(f) {
  const err = $('#customErr'), btn = $('#customBtn');
  if (!sb) { err.textContent = 'This site is not connected yet.'; return; }
  const fd = new FormData(f), v = n => String(fd.get(n) || '').trim();
  const file = fd.get('file');
  if (!file || !file.name) { err.textContent = 'Please choose your model file.'; return; }
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['stl', '3mf', 'obj'].includes(ext)) { err.textContent = 'The file must be an STL, 3MF or OBJ.'; return; }
  if (file.size > (C.MAX_STL_MB || 50) * 1048576) { err.textContent = 'That file is too large. The limit is ' + (C.MAX_STL_MB || 50) + ' MB.'; return; }
  if (!v('customer') || v('contact').length < 3) { err.textContent = 'Please enter your name and an email address or phone number.'; return; }
  err.textContent = ''; btn.disabled = true; btn.textContent = 'Uploading…';
  const path = 'uploads/' + crypto.randomUUID() + '.' + ext;
  const up = await sb.storage.from('stl-uploads').upload(path, file, {contentType: 'application/octet-stream', upsert: false});
  if (up.error) { err.textContent = 'The file did not upload. Please try again.'; btn.disabled = false; btn.textContent = 'Request a quote'; return; }
  const qty = Math.min(500, Math.max(1, Math.round(parseFloat(v('qty'))) || 1));
  const payload = {customer: v('customer'), contact: v('contact'), delivery: v('delivery') || 'collect', notes: '', website: v('website'),
    lines: [{custom: true, filename: file.name, stl_path: path, qty, material: v('material'), colour: v('colour'), note: v('note')}]};
  const {data, error} = await sb.rpc('place_order', {p: payload});
  if (error) { err.textContent = friendly(error); btn.disabled = false; btn.textContent = 'Request a quote'; return; }
  renderCustom({ref: data.ref});
}

/* ---------- order lookup ---------- */
function renderTrack(result, notFound) {
  const box = $('#trackBox');
  let out = '';
  if (notFound) out = '<p class="err" role="alert">We could not find an order with that reference and contact. Check both and try again.</p>';
  if (result) {
    const t = STAGE_TEXT[result.stage] || [result.stage, ''];
    out = '<div class="statusline"><span class="pill info">' + esc(t[0]) + '</span><span class="mono">' + esc(result.ref) + '</span><span>' + esc(t[1]) + '</span>' +
      (result.due && ['accepted', 'printing', 'ready'].includes(result.stage) ? '<span class="muted">Expected by ' + esc(new Date(result.due + 'T00:00:00').toLocaleDateString('en-GB', {day: 'numeric', month: 'long'})) + '.</span>' : '') + '</div>';
  }
  box.innerHTML = '<form id="trackForm" novalidate><div class="grid2"><label class="field"><span>Order reference</span><input name="ref" placeholder="FC-0001" autocomplete="off"></label>' +
    '<label class="field"><span>Email or phone you ordered with</span><input name="contact" autocomplete="off"></label></div>' +
    '<div style="margin-top:14px"><button class="btn primary" type="submit">Check progress</button></div></form>' + (out ? '<div id="trackOut">' + out + '</div>' : '');
}
async function submitTrack(f) {
  if (!sb) { renderTrack(null, false); return; }
  const fd = new FormData(f), ref = String(fd.get('ref') || '').trim(), contact = String(fd.get('contact') || '').trim();
  if (!ref || !contact) return;
  const {data, error} = await sb.rpc('order_status', {p_ref: ref, p_contact: contact});
  if (error || !data) { renderTrack(null, true); return; }
  renderTrack(data, false);
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  if (e.target.id === 'modal') { closeModal(); return; }
  if (e.target.closest('#cartBtn')) { openCart(); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const key = el.dataset.key, line = key ? cart.find(l => l.key === key) : null;
  switch (el.dataset.act) {
    case 'product': openProduct(el.dataset.id); break;
    case 'close': closeModal(); break;
    case 'inc': if (line) { line.qty = Math.min(500, line.qty + 1); saveCart(); updateCartBadge(); refreshCart(); } break;
    case 'dec': if (line) { line.qty = Math.max(1, line.qty - 1); saveCart(); updateCartBadge(); refreshCart(); } break;
    case 'rm': cart = cart.filter(l => l.key !== key); saveCart(); updateCartBadge(); refreshCart(); break;
    case 'another': renderCustom(null); break;
  }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const id = e.target.id;
  if (id === 'pmForm') addToCart();
  else if (id === 'orderForm') submitOrder(e.target);
  else if (id === 'customForm') submitCustom(e.target);
  else if (id === 'trackForm') submitTrack(e.target);
});
document.addEventListener('input', e => { if (e.target.closest('#pmForm')) updatePm(); });
document.addEventListener('change', e => { if (e.target.closest('#pmForm')) updatePm(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
  if (e.key === 'Tab' && !$('#modal').hidden) {
    const f = [...$('#panel').querySelectorAll('button:not([disabled]),input:not([type=hidden]),select,textarea')].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }
});

/* ---------- boot ---------- */
document.title = (BRAND.name || 'Form&Co') + ' | ' + (BRAND.tagline || 'Custom 3D printing');
$('#brand').textContent = BRAND.name || 'Form&Co';
$('#tagline').textContent = BRAND.tagline || 'Custom 3D printing';
$('#intro').textContent = BRAND.intro || '';
$('#footLine').textContent = [BRAND.name, BRAND.contactLine].filter(Boolean).join(' · ');
if (!configured) $('#setupNote').hidden = false;
updateCartBadge(); renderGallery(); renderCustom(null); renderTrack(null, false); loadProducts();
})();
