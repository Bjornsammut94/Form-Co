/* Form&Co admin: sign in, live job board, catalogue, rates. */
(() => {
'use strict';
const C = window.FC_CONFIG || {};
const BRAND = (C.BRAND && C.BRAND.name) || 'Form&Co';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eur = n => new Intl.NumberFormat('en-GB', {style: 'currency', currency: 'EUR'}).format(+n || 0);
const arr = v => Array.isArray(v) ? v : [];

const configured = C.SUPABASE_URL && C.SUPABASE_ANON_KEY && !/YOUR-/.test(C.SUPABASE_URL + C.SUPABASE_ANON_KEY);
const sb = configured && window.supabase ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;

const STAGES = [
  {k: 'new', label: 'New request'},
  {k: 'quote', label: 'Quote sent', next: 'accepted', nextLabel: 'Mark accepted'},
  {k: 'accepted', label: 'Accepted', next: 'printing', nextLabel: 'Start printing'},
  {k: 'printing', label: 'Printing', next: 'ready', nextLabel: 'Mark ready'},
  {k: 'ready', label: 'Ready to collect', next: 'collected', nextLabel: 'Mark collected'},
  {k: 'collected', label: 'Collected'},
  {k: 'declined', label: 'Declined'}
];
const ACTIVE = ['new', 'quote', 'accepted', 'printing', 'ready'];
const stageOf = k => STAGES.find(s => s.k === k) || STAGES[1];
const DEFAULT_RATES = {materials: {PLA: 22, PETG: 26, ABS: 25, ASA: 30, TPU: 38}, machine: 1.5, setup: 2, markup: 40, min: 5, round: 0.5};

let jobs = [], products = [], rates = JSON.parse(JSON.stringify(DEFAULT_RATES)), ratesSaved = false;
const ui = {tab: 'board', chip: 'all', q: ''};
const busy = new Set(), known = new Set();
let started = false, firstLoad = true, pollTimer = null, toastTimer = null, lastFocus = null;
let editing = null, delArmed = false;

try { const s = JSON.parse(localStorage.getItem('fc-admin-ui') || '{}'); if (['board', 'list', 'catalogue'].includes(s.tab)) ui.tab = s.tab; } catch (e) {}
const saveUi = () => { try { localStorage.setItem('fc-admin-ui', JSON.stringify({tab: ui.tab})); } catch (e) {} };

/* ---------- helpers ---------- */
const today = (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); })();
const parseDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const fmtDate = s => { const d = parseDate(s); return d ? d.toLocaleDateString('en-GB', {day: 'numeric', month: 'short'}) : ''; };
function dueInfo(j) {
  const d = parseDate(j.due); if (!d) return null;
  const text = fmtDate(j.due);
  if (!['accepted', 'printing', 'ready'].includes(j.stage)) return {text: 'Due ' + text, cls: ''};
  const days = Math.round((d - today) / 864e5);
  if (days < 0) return {text: 'Overdue ' + (-days) + 'd', cls: 'crit'};
  if (days === 0) return {text: 'Due today', cls: 'warn'};
  if (days === 1) return {text: 'Due tomorrow', cls: 'warn'};
  if (days === 2) return {text: 'Due in 2 days', cls: 'warn'};
  return {text: 'Due ' + text, cls: ''};
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3600);
}
const errText = e => (e && e.message) ? e.message : 'That did not work. Try again.';
const mergeRates = s => {
  const r = JSON.parse(JSON.stringify(DEFAULT_RATES));
  if (s && typeof s === 'object') {
    for (const k of ['machine', 'setup', 'markup', 'min', 'round']) if (typeof s[k] === 'number') r[k] = s[k];
    if (s.materials && typeof s.materials === 'object') for (const m of Object.keys(s.materials)) if (typeof s.materials[m] === 'number') r.materials[m] = s.materials[m];
  }
  return r;
};
function calc(j, r) {
  const q = Math.max(1, +j.qty || 1);
  const mat = ((+j.weight_g || 0) / 1000) * (+r.materials[j.material] || 0) * q;
  const mach = (+j.hours || 0) * (+r.machine || 0) * q;
  const setup = +r.setup || 0, extras = +j.extras || 0;
  const base = mat + mach + setup + extras, markup = base * ((+r.markup || 0) / 100);
  const step = +r.round > 0 ? +r.round : 0.5;
  let total = Math.ceil((base + markup) / step - 1e-9) * step;
  const floored = total < (+r.min || 0);
  total = Math.max(total, +r.min || 0);
  return {mat, mach, setup, extras, markup, total, floored, q};
}
const isAsset = path => /^assets\//.test(path || '');
const productImg = p => !p.image_path ? '' : isAsset(p.image_path) ? p.image_path : sb.storage.from('product-images').getPublicUrl(p.image_path).data.publicUrl;

/* ---------- modal ---------- */
function openModal(html) {
  lastFocus = document.activeElement;
  $('#panel').innerHTML = html; $('#modal').hidden = false; document.documentElement.style.overflow = 'hidden';
  const f = $('#panel input:not([type=hidden]),#panel select,#panel textarea'); if (f) f.focus();
}
function closeModal() {
  $('#modal').hidden = true; $('#panel').innerHTML = ''; editing = null; delArmed = false;
  document.documentElement.style.overflow = '';
  if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
}

/* ---------- login ---------- */
function renderLogin(msg) {
  $('#app').innerHTML = '<form class="login" id="loginForm" novalidate><div class="brand"><h1>' + esc(BRAND) + '</h1><span class="tag">Admin</span></div><h2>Sign in</h2>' +
    '<label class="field"><span>Email</span><input name="email" type="email" autocomplete="username"></label>' +
    '<label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password"></label>' +
    '<span class="err" id="loginErr" role="alert">' + esc(msg || '') + '</span>' +
    '<button class="btn primary" type="submit" id="loginBtn">Sign in</button></form>';
}
function renderDenied(email) {
  $('#app').innerHTML = '<div class="login"><h2>Not set up as an admin</h2><p class="muted">' + esc(email || 'This account') + ' is signed in, but it is not in the admins list. Add the email in schema.sql (or the admins table) and sign in again.</p><button class="btn" type="button" data-act="signout">Sign out</button></div>';
}
async function submitLogin(f) {
  const fd = new FormData(f), btn = $('#loginBtn'), err = $('#loginErr');
  err.textContent = ''; btn.disabled = true;
  const {data, error} = await sb.auth.signInWithPassword({email: String(fd.get('email') || '').trim(), password: String(fd.get('password') || '')});
  if (error) { err.textContent = 'Email or password not recognised.'; btn.disabled = false; return; }
  await handleSession(data.session);
}
async function handleSession(session) {
  if (!session) { renderLogin(); return; }
  const {data, error} = await sb.rpc('is_admin');
  if (error || data !== true) { renderDenied(session.user && session.user.email); return; }
  startApp();
}

/* ---------- shell ---------- */
function buildShell() {
  $('#app').innerHTML =
    '<header class="top"><div class="brand"><h1>' + esc(BRAND) + '</h1><span class="tag">Admin</span></div><div class="top-actions">' +
    '<button class="btn" type="button" data-act="rates">Rates</button>' +
    '<button class="btn" type="button" data-act="export">Export CSV</button>' +
    '<button class="btn quiet" type="button" data-act="signout">Sign out</button>' +
    '<button class="btn primary" type="button" data-act="new">New job</button></div></header>' +
    '<div id="notice" class="notice" hidden></div><section class="stats" id="stats" aria-label="Summary"></section>' +
    '<div class="toolbar"><div class="seg" role="group" aria-label="View">' +
    '<button type="button" data-act="tab" data-v="board">Board</button><button type="button" data-act="tab" data-v="list">List</button><button type="button" data-act="tab" data-v="catalogue">Catalogue</button></div>' +
    '<div class="chips" id="chips" role="group" aria-label="Filter by stage"></div>' +
    '<input class="search" id="q" type="search" placeholder="Search customer, item or ref" aria-label="Search jobs"></div>' +
    '<main id="view" aria-live="polite"></main>';
}

/* ---------- render ---------- */
function visible() {
  const q = ui.q.trim().toLowerCase();
  let list = jobs.filter(j => ui.chip === 'all' ? (q && ui.tab === 'list' ? true : ACTIVE.includes(j.stage)) : j.stage === ui.chip);
  if (q) list = list.filter(j => [j.ref, j.customer, j.item, j.contact, j.colour, j.material].join(' ').toLowerCase().includes(q));
  return list.slice().sort((a, b) => {
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    if (a.due && !b.due) return -1;
    if (!a.due && b.due) return 1;
    return String(b.created_at).localeCompare(String(a.created_at));
  });
}
function renderStats() {
  const sum = a => a.reduce((s, j) => s + (+j.price || 0), 0);
  const fresh = jobs.filter(j => j.stage === 'new');
  const quotes = jobs.filter(j => j.stage === 'quote');
  const prod = jobs.filter(j => j.stage === 'accepted' || j.stage === 'printing');
  const owed = jobs.filter(j => ['accepted', 'printing', 'ready', 'collected'].includes(j.stage) && !j.paid && +j.price > 0);
  const cell = (k, v, s) => '<div class="stat"><span class="k">' + k + '</span><span class="v mono">' + v + '</span><span class="s">' + s + '</span></div>';
  $('#stats').innerHTML =
    cell('New requests', fresh.length, fresh.length ? 'waiting for you' : 'nothing waiting') +
    cell('Quotes out', quotes.length, eur(sum(quotes)) + ' quoted') +
    cell('In production', prod.length, jobs.filter(j => j.stage === 'printing').length + ' printing now') +
    cell('Still to be paid', eur(sum(owed)), owed.length + (owed.length === 1 ? ' job' : ' jobs'));
}
function renderChips() {
  const count = k => k === 'all' ? jobs.filter(j => ACTIVE.includes(j.stage)).length : jobs.filter(j => j.stage === k).length;
  const items = [{k: 'all', label: 'All active'}].concat(STAGES.map(s => ({k: s.k, label: s.label})));
  $('#chips').innerHTML = items.map(i => '<button type="button" class="chip" data-act="chip" data-s="' + i.k + '" aria-pressed="' + (ui.chip === i.k) + '">' + esc(i.label) + ' <span class="n">' + count(i.k) + '</span></button>').join('');
}
function nextFor(j) {
  if (j.stage === 'new') return +j.price > 0 ? {to: 'accepted', label: 'Accept order'} : {to: 'quote', label: 'Mark quote sent'};
  const s = stageOf(j.stage); return s.next ? {to: s.next, label: s.nextLabel} : null;
}
function card(j) {
  const due = dueInfo(j), nx = nextFor(j), b = busy.has(j.id) ? ' disabled' : '';
  const owes = ['accepted', 'printing', 'ready', 'collected'].includes(j.stage) && +j.price > 0;
  const spec = [+j.qty > 1 ? '×' + j.qty : '', j.material, j.colour].filter(Boolean).join(' · ');
  let actions = '';
  if (nx) actions += '<button class="btn small primary" type="button" data-act="advance" data-id="' + esc(j.id) + '" data-to="' + nx.to + '"' + b + '>' + nx.label + '</button>';
  if (j.stage === 'declined') actions += '<button class="btn small" type="button" data-act="advance" data-id="' + esc(j.id) + '" data-to="quote"' + b + '>Reopen</button>';
  actions += '<button class="btn small" type="button" data-act="edit" data-id="' + esc(j.id) + '">' + (j.stage === 'new' ? 'Review' : 'Edit') + '</button>';
  if (j.stage === 'new' || j.stage === 'quote') actions += '<button class="btn small quiet" type="button" data-act="advance" data-id="' + esc(j.id) + '" data-to="declined"' + b + '>Decline</button>';
  return '<article class="card' + (j.stage === 'new' ? ' fresh' : '') + '"><div class="card-top"><span class="ref">' + esc(j.ref) + '</span>' +
    (j.source === 'web' ? '<span class="pill info">Web</span>' : '') + (j.delivery === 'delivery' ? '<span class="pill">Delivery</span>' : '') +
    (owes ? (j.paid ? '<span class="pill ok">Paid</span>' : '<span class="pill warn">Unpaid</span>') : '') + '</div>' +
    '<h3>' + esc(j.item || 'Untitled job') + '</h3><p class="cust">' + esc(j.customer) + (j.contact ? ' <span class="sub">· ' + esc(j.contact) + '</span>' : '') + '</p>' +
    (spec ? '<p class="spec">' + esc(spec) + '</p>' : '') +
    '<div class="card-mid"><span class="price">' + (+j.price > 0 ? eur(j.price) : 'Needs a price') + '</span>' + (due ? '<span class="pill ' + due.cls + '">' + due.text + '</span>' : '') + '</div>' +
    '<div class="card-actions">' + actions + '</div></article>';
}
function renderBoard(list) {
  const cols = ui.chip === 'all' ? ACTIVE : [ui.chip];
  return '<div class="board">' + cols.map(k => {
    const items = list.filter(j => j.stage === k);
    return '<section class="col" style="--st:var(--st-' + k + ')"><header class="col-head"><span class="dot"></span><h2>' + esc(stageOf(k).label) + '</h2><span class="count mono">' + items.length + '</span></header><div class="col-body">' +
      (items.length ? items.map(card).join('') : '<p class="muted empty">Nothing here.</p>') + '</div></section>';
  }).join('') + '</div>';
}
function renderList(list) {
  if (!list.length) return '<p class="muted empty">No jobs match.</p>';
  return '<div class="tablewrap"><table><thead><tr><th>Ref</th><th>Customer</th><th>Item</th><th>Stage</th><th>Due</th><th class="num">Price</th><th>Paid</th></tr></thead><tbody>' +
    list.map(j => {
      const due = dueInfo(j);
      return '<tr data-id="' + esc(j.id) + '"><td><button type="button" class="reflink" data-act="edit" data-id="' + esc(j.id) + '">' + esc(j.ref) + '</button></td>' +
        '<td>' + esc(j.customer) + (j.source === 'web' ? ' <span class="pill info">Web</span>' : '') + (j.contact ? '<div class="sub">' + esc(j.contact) + '</div>' : '') + '</td>' +
        '<td>' + esc(j.item) + '<div class="sub">' + esc([+j.qty > 1 ? '×' + j.qty : '', j.material, j.colour].filter(Boolean).join(' · ')) + '</div></td>' +
        '<td><span class="stage" style="--st:var(--st-' + j.stage + ')"><span class="dot"></span>' + esc(stageOf(j.stage).label) + '</span></td>' +
        '<td>' + (due ? '<span class="pill ' + due.cls + '">' + due.text + '</span>' : '<span class="muted">—</span>') + '</td>' +
        '<td class="num mono">' + (+j.price > 0 ? eur(j.price) : '—') + '</td><td>' + (j.paid ? '<span class="pill ok">Paid</span>' : '<span class="muted">—</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}
function renderCatalogue() {
  const head = '<div class="cathead"><h2>Catalogue</h2><button class="btn primary" type="button" data-act="newproduct">Add a model</button></div>';
  if (!products.length) return head + '<div class="blank"><h2>No models yet</h2><p>Add the designs you made. Customers see active models on your website, choose a colour and material, and order them.</p><button class="btn primary" type="button" data-act="newproduct">Add a model</button></div>';
  return head + '<div class="tablewrap"><table><thead><tr><th></th><th>Model</th><th class="num">Price</th><th>Options</th><th>Shown</th><th></th></tr></thead><tbody>' +
    products.map(p => {
      const u = productImg(p);
      return '<tr><td class="thumbcell">' + (u ? '<img src="' + esc(u) + '" alt="">' : '<div class="minithumb ph"></div>') + '</td>' +
        '<td><strong>' + esc(p.name) + '</strong><div class="sub">' + esc(p.description).slice(0, 90) + '</div></td>' +
        '<td class="num mono">' + eur(p.price) + '</td>' +
        '<td class="sub">' + esc([arr(p.materials).map(m => m.name).join(', '), arr(p.colours).join(', ')].filter(Boolean).join(' / ')) + '</td>' +
        '<td>' + (p.active ? '<span class="pill ok">Visible</span>' : '<span class="pill">Hidden</span>') + '</td>' +
        '<td><button class="btn small" type="button" data-act="editproduct" data-id="' + esc(p.id) + '">Edit</button></td></tr>';
    }).join('') + '</tbody></table></div>';
}
function renderView() {
  const el = $('#view'); if (!el) return;
  if (ui.tab === 'catalogue') { el.innerHTML = renderCatalogue(); return; }
  if (!jobs.length) { el.innerHTML = '<div class="blank"><h2>No jobs yet</h2><p>Orders and quote requests from your website appear here as they arrive. You can also add one by hand.</p><button class="btn primary" type="button" data-act="new">New job</button></div>'; return; }
  const list = visible();
  el.innerHTML = ui.tab === 'board' ? renderBoard(list) : renderList(list);
}
function render() {
  if (!$('#view')) return;
  document.querySelectorAll('[data-act="tab"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === ui.tab)));
  const cat = ui.tab === 'catalogue';
  $('#chips').hidden = cat; $('#q').hidden = cat; $('#stats').hidden = false;
  renderStats(); renderChips(); renderView();
  const n = jobs.filter(j => j.stage === 'new').length;
  document.title = (n ? '(' + n + ') ' : '') + BRAND + ' Admin';
}
function showNotice(msg) { const el = $('#notice'); if (!el) return; el.hidden = !msg; el.textContent = msg || ''; }

/* ---------- data ---------- */
async function loadJobs() {
  const {data, error} = await sb.from('jobs').select('*').order('created_at', {ascending: false});
  if (error) { showNotice('Could not load jobs: ' + errText(error)); return; }
  showNotice('');
  jobs = data || [];
  if (!firstLoad) {
    const fresh = jobs.filter(j => !known.has(j.id) && j.source === 'web');
    if (fresh.length) toast(fresh.length === 1 ? 'New order ' + fresh[0].ref + ' from ' + fresh[0].customer : fresh.length + ' new orders');
  }
  jobs.forEach(j => known.add(j.id)); firstLoad = false;
  render();
}
async function loadProducts() {
  const {data, error} = await sb.from('products').select('*').order('sort').order('name');
  if (!error) products = data || [];
  if (ui.tab === 'catalogue') renderView();
}
async function loadRates() {
  const {data} = await sb.from('settings').select('value').eq('key', 'rates').maybeSingle();
  if (data && data.value) { rates = mergeRates(data.value); ratesSaved = true; }
}
async function startApp() {
  if (started) return; started = true;
  buildShell();
  await Promise.all([loadRates(), loadProducts(), loadJobs()]);
  render();
  sb.channel('jobs-feed').on('postgres_changes', {event: '*', schema: 'public', table: 'jobs'}, () => loadJobs()).subscribe();
  pollTimer = setInterval(() => { if (!document.hidden) loadJobs(); }, 30000);
}

/* ---------- job editor ---------- */
const nv = v => (v === undefined || v === null || v === 0) ? '' : v;
function matOptions(sel) {
  const names = Object.keys(rates.materials); if (sel && !names.includes(sel)) names.push(sel);
  return '<option value=""></option>' + names.map(n => '<option value="' + esc(n) + '"' + (n === sel ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
}
function linesBlock(j) {
  const lines = arr(j.lines); if (!lines.length) return '';
  return '<section class="block"><h3>Customer order</h3><div class="orderlines">' + lines.map(l => {
    if (l.custom) return '<div class="oline"><div><div class="nm">Custom file: ' + esc(l.filename || 'model') + '</div><div class="sub">×' + esc(l.qty) + ' · ' + esc([l.material, l.colour].filter(Boolean).join(' · ')) + (l.note ? ' · “' + esc(l.note) + '”' : '') + '</div></div>' +
      '<button class="btn small" type="button" data-act="dlstl" data-path="' + esc(l.stl_path) + '">Download file</button></div>';
    return '<div class="oline"><div><div class="nm">' + esc(l.name) + '</div><div class="sub">×' + esc(l.qty) + ' · ' + esc([l.material, l.colour].filter(Boolean).join(' · ')) + '</div></div><span class="mono">' + eur((+l.unit_price || 0) * (+l.qty || 1)) + '</span></div>';
  }).join('') + '</div></section>';
}
function openEditor(id) {
  const j = id ? jobs.find(x => x.id === id) : null; if (id && !j) return;
  const d = j || {stage: 'quote', qty: 1, material: 'PLA', delivery: 'collect', paid: false, lines: []};
  editing = j ? j.id : null; delArmed = false;
  openModal('<form id="jobForm" novalidate><div class="panel-head"><h2 id="panelTitle">' + (j ? esc(j.ref) + (j.source === 'web' ? ' · web order' : '') : 'New job') + '</h2><button class="btn small quiet" type="button" data-act="close">Close</button></div>' +
    '<div class="panel-body">' + linesBlock(d) +
    '<section class="block"><h3>Customer and item</h3><div class="grid2">' +
    '<label class="field"><span>Customer *</span><input name="customer" value="' + esc(d.customer) + '" autocomplete="off"></label>' +
    '<label class="field"><span>Email, phone or Facebook</span><input name="contact" value="' + esc(d.contact) + '" autocomplete="off"></label>' +
    '<label class="field wide"><span>Item *</span><input name="item" value="' + esc(d.item) + '" autocomplete="off"></label>' +
    '<label class="field"><span>Colour</span><input name="colour" value="' + esc(d.colour) + '" autocomplete="off"></label>' +
    '<label class="field"><span>Stage</span><select name="stage">' + STAGES.map(s => '<option value="' + s.k + '"' + (s.k === d.stage ? ' selected' : '') + '>' + esc(s.label) + '</option>').join('') + '</select></label>' +
    '<label class="field"><span>Needed by</span><input type="date" name="due" value="' + esc(d.due || '') + '"></label>' +
    '<label class="field"><span>Collection or delivery</span><select name="delivery"><option value="collect"' + (d.delivery === 'collect' ? ' selected' : '') + '>Collect</option><option value="delivery"' + (d.delivery === 'delivery' ? ' selected' : '') + '>Delivery</option></select></label>' +
    '<label class="field wide"><span>Notes</span><textarea name="notes">' + esc(d.notes) + '</textarea></label></div></section>' +
    '<section class="block"><h3>Price</h3><div class="grid3">' +
    '<label class="field"><span>Material</span><select name="material">' + matOptions(d.material) + '</select></label>' +
    '<label class="field"><span>Quantity</span><input type="number" name="qty" min="1" step="1" inputmode="numeric" value="' + esc(d.qty || 1) + '"></label>' +
    '<label class="field"><span>Extras (€)</span><input type="number" name="extras" min="0" step="0.5" inputmode="decimal" value="' + esc(nv(d.extras)) + '"></label>' +
    '<label class="field"><span>Weight per piece (g)</span><input type="number" name="weight_g" min="0" step="1" inputmode="decimal" value="' + esc(nv(d.weight_g)) + '"></label>' +
    '<label class="field"><span>Print time per piece (h)</span><input type="number" name="hours" min="0" step="0.25" inputmode="decimal" value="' + esc(nv(d.hours)) + '"></label></div>' +
    '<div class="calc-out" id="calcOut"></div><div class="grid2">' +
    '<label class="field"><span>Price charged (€)</span><input type="number" name="price" min="0" step="0.5" inputmode="decimal" value="' + esc(d.price === null || d.price === undefined ? '' : d.price) + '"></label>' +
    '<label class="check"><input type="checkbox" name="paid"' + (d.paid ? ' checked' : '') + '> Paid in full</label></div></section>' +
    '<textarea id="qf" readonly hidden aria-label="Quote message" rows="5"></textarea></div>' +
    '<div class="panel-foot"><span class="err" id="formErr" role="alert"></span><span class="spacer"></span>' +
    (j ? '<button class="btn danger" type="button" data-act="del">Delete</button>' : '') +
    '<button class="btn" type="button" data-act="copyquote">Copy quote message</button><button class="btn primary" type="submit">Save job</button></div></form>');
  updateCalc();
}
function readForm(f) {
  const fd = new FormData(f), v = n => String(fd.get(n) ?? '').trim();
  const num = n => { const x = parseFloat(v(n)); return isFinite(x) && x >= 0 ? x : 0; };
  return {customer: v('customer'), contact: v('contact'), item: v('item'), colour: v('colour'), material: v('material'), delivery: v('delivery') || 'collect',
    qty: Math.max(1, Math.round(num('qty')) || 1), weight_g: num('weight_g'), hours: num('hours'), extras: num('extras'),
    price: v('price') === '' ? null : num('price'), paid: fd.get('paid') === 'on', due: v('due') || null, stage: v('stage'), notes: v('notes')};
}
function updateCalc() {
  const f = $('#jobForm'), out = $('#calcOut'); if (!f || !out) return;
  const j = readForm(f), note = ratesSaved ? '' : '<p class="sub">Calculated with starting rates. Set your own under Rates.</p>';
  if (!(j.weight_g > 0 || j.hours > 0)) { out.innerHTML = '<p class="muted">Enter weight and print time to get a suggested price.</p>' + note; return; }
  const c = calc(j, rates), g = +(j.weight_g * c.q).toFixed(1), h = +(j.hours * c.q).toFixed(2);
  const row = (a, b) => '<div class="row"><span>' + a + '</span><span class="mono">' + b + '</span></div>';
  out.innerHTML = row('Filament · ' + g + ' g at ' + eur(rates.materials[j.material] || 0) + '/kg', eur(c.mat)) + row('Machine · ' + h + ' h at ' + eur(rates.machine) + '/h', eur(c.mach)) +
    row('Setup', eur(c.setup)) + (c.extras ? row('Extras', eur(c.extras)) : '') + row('Markup · ' + rates.markup + '%', eur(c.markup)) +
    '<div class="row total"><span>Suggested' + (c.floored ? ' (minimum charge)' : '') + '</span><span class="mono">' + eur(c.total) + '</span></div>' +
    '<div><button class="btn small" type="button" data-act="usecalc" data-total="' + c.total + '">Use ' + eur(c.total) + '</button></div>' + note;
}
function quoteText(j) {
  const first = (j.customer || '').split(/\s+/)[0] || 'there';
  return 'Hi ' + first + ', here is your quote from ' + BRAND + (j.ref ? ' (ref ' + j.ref + ')' : '') + ':\n' + (j.qty > 1 ? j.qty + ' × ' : '') + j.item + (j.material ? ' in ' + j.material : '') + (j.colour ? ' (' + j.colour + ')' : '') +
    '\nPrice: ' + eur(j.price) + '.' + (j.due ? ' We can have it ready by ' + fmtDate(j.due) + '.' : '') + '\nLet me know if you would like to go ahead.';
}
async function copyQuote() {
  const f = $('#jobForm'); if (!f) return;
  const j = readForm(f), err = $('#formErr');
  if (!j.item || !(j.price > 0)) { err.textContent = 'Add an item and a price first.'; return; }
  err.textContent = '';
  const cur = editing ? jobs.find(x => x.id === editing) : null;
  const text = quoteText(Object.assign({ref: cur && cur.ref}, j));
  try { await navigator.clipboard.writeText(text); toast('Quote message copied'); }
  catch (e) { const qf = $('#qf'); qf.value = text; qf.hidden = false; qf.focus(); qf.select(); toast('Select the text and copy it'); }
}
async function submitJob(f) {
  const err = $('#formErr'), d = readForm(f);
  if (!d.customer || !d.item) { err.textContent = 'Customer and item are required.'; return; }
  err.textContent = ''; const btn = f.querySelector('[type=submit]'); btn.disabled = true;
  const res = editing ? await sb.from('jobs').update(d).eq('id', editing) : await sb.from('jobs').insert(Object.assign({source: 'manual'}, d));
  if (res.error) { err.textContent = errText(res.error); btn.disabled = false; return; }
  closeModal(); toast('Job saved'); loadJobs();
}
async function deleteJob(btn) {
  if (!delArmed) { delArmed = true; btn.textContent = 'Tap again to delete'; return; }
  const j = jobs.find(x => x.id === editing); btn.disabled = true;
  const {error} = await sb.from('jobs').delete().eq('id', editing);
  if (error) { toast(errText(error)); btn.disabled = false; return; }
  const paths = j ? arr(j.lines).filter(l => l.custom && l.stl_path).map(l => l.stl_path) : [];
  if (paths.length) sb.storage.from('stl-uploads').remove(paths);
  closeModal(); toast('Job deleted'); loadJobs();
}
async function advance(id, to) {
  if (busy.has(id)) return; busy.add(id); renderView();
  const {error} = await sb.from('jobs').update({stage: to}).eq('id', id);
  busy.delete(id);
  if (error) { toast(errText(error)); renderView(); return; }
  toast(to === 'declined' ? 'Declined' : 'Moved to ' + stageOf(to).label); loadJobs();
}
async function downloadStl(path) {
  const {data, error} = await sb.storage.from('stl-uploads').createSignedUrl(path, 300);
  if (error || !data) { toast('Could not open the file.'); return; }
  const a = document.createElement('a'); a.href = data.signedUrl; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- catalogue editor ---------- */
const matsToText = ms => arr(ms).map(m => m.name + (+m.extra > 0 ? ' +' + m.extra : '')).join('\n');
function parseMats(text) {
  return String(text || '').split('\n').map(s => s.trim()).filter(Boolean).map(s => {
    const m = /^(.*?)\s*(?:\+\s*([0-9]+(?:\.[0-9]+)?))?$/.exec(s);
    return {name: (m && m[1] || s).trim(), extra: m && m[2] ? parseFloat(m[2]) : 0};
  }).filter(m => m.name);
}
function openProduct(id) {
  const p = id ? products.find(x => x.id === id) : null; if (id && !p) return;
  const d = p || {name: '', description: '', price: '', colours: [], materials: [], active: true, sort: 0};
  editing = p ? p.id : null; delArmed = false;
  const u = p && p.image_path ? productImg(p) : '';
  openModal('<form id="productForm" novalidate><div class="panel-head"><h2 id="panelTitle">' + (p ? 'Edit model' : 'Add a model') + '</h2><button class="btn small quiet" type="button" data-act="close">Close</button></div>' +
    '<div class="panel-body"><div class="grid2">' +
    '<label class="field wide"><span>Name *</span><input name="name" value="' + esc(d.name) + '" autocomplete="off"></label>' +
    '<label class="field wide"><span>Description</span><textarea name="description">' + esc(d.description) + '</textarea></label>' +
    '<label class="field"><span>Base price (€) *</span><input type="number" name="price" min="0" step="0.5" inputmode="decimal" value="' + esc(d.price) + '"></label>' +
    '<label class="field"><span>Order on the page</span><input type="number" name="sort" step="1" inputmode="numeric" value="' + esc(d.sort || 0) + '"></label>' +
    '<label class="field"><span>Colours, separated by commas</span><input name="colours" value="' + esc(arr(d.colours).join(', ')) + '" placeholder="Black, White, Red"></label>' +
    '<label class="field"><span>Materials, one per line. Add +2 for a surcharge</span><textarea name="materials" placeholder="PLA&#10;PETG +2">' + esc(matsToText(d.materials)) + '</textarea></label>' +
    '<label class="field wide"><span>Photo (JPG or PNG, up to 5 MB)</span><input type="file" name="image" accept="image/*"></label>' +
    (u ? '<div class="wide"><img class="preview" src="' + esc(u) + '" alt="Current photo"></div>' : '') +
    '<label class="check"><input type="checkbox" name="active"' + (d.active ? ' checked' : '') + '> Show on the website</label></div></div>' +
    '<div class="panel-foot"><span class="err" id="formErr" role="alert"></span><span class="spacer"></span>' +
    (p ? '<button class="btn danger" type="button" data-act="delproduct">Delete</button>' : '') +
    '<button class="btn primary" type="submit">Save model</button></div></form>');
}
async function submitProduct(f) {
  const err = $('#formErr'), fd = new FormData(f), v = n => String(fd.get(n) ?? '').trim();
  const price = parseFloat(v('price'));
  if (!v('name') || !isFinite(price) || price < 0) { err.textContent = 'A name and a price are required.'; return; }
  err.textContent = ''; const btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Saving…';
  const cur = editing ? products.find(x => x.id === editing) : null;
  let image_path = cur ? cur.image_path : null;
  const file = fd.get('image');
  if (file && file.name) {
    if (!/^image\//.test(file.type) || file.size > 5 * 1048576) { err.textContent = 'The photo must be an image under 5 MB.'; btn.disabled = false; btn.textContent = 'Save model'; return; }
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
    const path = crypto.randomUUID() + '.' + ext;
    const up = await sb.storage.from('product-images').upload(path, file, {contentType: file.type, upsert: false});
    if (up.error) { err.textContent = 'The photo did not upload: ' + errText(up.error); btn.disabled = false; btn.textContent = 'Save model'; return; }
    if (image_path && !isAsset(image_path)) sb.storage.from('product-images').remove([image_path]);
    image_path = path;
  }
  const row = {name: v('name'), description: v('description'), price, sort: Math.round(parseFloat(v('sort')) || 0),
    colours: v('colours').split(',').map(s => s.trim()).filter(Boolean), materials: parseMats(fd.get('materials')), active: fd.get('active') === 'on', image_path};
  const res = editing ? await sb.from('products').update(row).eq('id', editing) : await sb.from('products').insert(row);
  if (res.error) { err.textContent = errText(res.error); btn.disabled = false; btn.textContent = 'Save model'; return; }
  closeModal(); toast('Model saved'); loadProducts();
}
async function deleteProduct(btn) {
  if (!delArmed) { delArmed = true; btn.textContent = 'Tap again to delete'; return; }
  const p = products.find(x => x.id === editing); btn.disabled = true;
  const {error} = await sb.from('products').delete().eq('id', editing);
  if (error) { toast(errText(error)); btn.disabled = false; return; }
  if (p && p.image_path && !isAsset(p.image_path)) sb.storage.from('product-images').remove([p.image_path]);
  closeModal(); toast('Model deleted'); loadProducts();
}

/* ---------- rates ---------- */
function openRates() {
  const mats = Object.keys(rates.materials).map(m => '<label class="field"><span>' + esc(m) + ' (€ per kg)</span><input type="number" name="m_' + esc(m) + '" min="0" step="0.5" inputmode="decimal" value="' + rates.materials[m] + '"></label>').join('');
  openModal('<form id="ratesForm" novalidate><div class="panel-head"><h2 id="panelTitle">Rates</h2><button class="btn small quiet" type="button" data-act="close">Close</button></div>' +
    '<div class="panel-body"><p class="muted">' + (ratesSaved ? 'These rates drive the suggested price on every job.' : 'These are starting values, not your costs. Change them to match what you pay and want to earn.') + '</p>' +
    '<section class="block"><h3>Filament</h3><div class="grid3">' + mats + '</div></section>' +
    '<section class="block"><h3>Machine and margin</h3><div class="grid3">' +
    '<label class="field"><span>Machine time (€ per hour)</span><input type="number" name="machine" min="0" step="0.1" inputmode="decimal" value="' + rates.machine + '"></label>' +
    '<label class="field"><span>Setup per job (€)</span><input type="number" name="setup" min="0" step="0.5" inputmode="decimal" value="' + rates.setup + '"></label>' +
    '<label class="field"><span>Markup (%)</span><input type="number" name="markup" min="0" step="1" inputmode="decimal" value="' + rates.markup + '"></label>' +
    '<label class="field"><span>Minimum charge (€)</span><input type="number" name="min" min="0" step="0.5" inputmode="decimal" value="' + rates.min + '"></label>' +
    '<label class="field"><span>Round up to (€)</span><input type="number" name="round" min="0.1" step="0.1" inputmode="decimal" value="' + rates.round + '"></label></div></section>' +
    '<p class="sub">Price = (filament + machine time) × quantity + setup + extras, plus markup, rounded up, never below the minimum charge.</p></div>' +
    '<div class="panel-foot"><span class="err" id="formErr" role="alert"></span><span class="spacer"></span><button class="btn" type="button" data-act="close">Cancel</button><button class="btn primary" type="submit">Save rates</button></div></form>');
}
async function submitRates(f) {
  const fd = new FormData(f), n = (k, fb) => { const x = parseFloat(fd.get(k)); return isFinite(x) && x >= 0 ? x : fb; };
  const r = JSON.parse(JSON.stringify(rates));
  for (const m of Object.keys(r.materials)) r.materials[m] = n('m_' + m, r.materials[m]);
  for (const k of ['machine', 'setup', 'markup', 'min']) r[k] = n(k, r[k]);
  r.round = Math.max(0.1, n('round', r.round));
  const {error} = await sb.from('settings').upsert({key: 'rates', value: r});
  if (error) { $('#formErr').textContent = errText(error); return; }
  rates = r; ratesSaved = true; closeModal(); toast('Rates saved');
}

/* ---------- export ---------- */
function exportCsv() {
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['Ref', 'Stage', 'Source', 'Customer', 'Contact', 'Item', 'Qty', 'Material', 'Colour', 'Weight g', 'Hours', 'Extras', 'Price', 'Paid', 'Needed by', 'Delivery', 'Created', 'Notes'];
  const rows = jobs.slice().sort((a, b) => a.ref.localeCompare(b.ref)).map(j => [j.ref, stageOf(j.stage).label, j.source, j.customer, j.contact, j.item, j.qty, j.material, j.colour, j.weight_g, j.hours, j.extras, j.price, j.paid ? 'yes' : 'no', j.due, j.delivery, j.created_at, j.notes]);
  const csv = [head].concat(rows).map(r => r.map(cell).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'}));
  a.download = 'form-and-co-jobs-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  if (e.target.id === 'modal') { closeModal(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) { const tr = e.target.closest('tr[data-id]'); if (tr) openEditor(tr.dataset.id); return; }
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'new': openEditor(null); break;
    case 'edit': openEditor(id); break;
    case 'advance': advance(id, el.dataset.to); break;
    case 'tab': ui.tab = el.dataset.v; saveUi(); render(); break;
    case 'chip': ui.chip = el.dataset.s; render(); break;
    case 'rates': openRates(); break;
    case 'export': exportCsv(); break;
    case 'close': closeModal(); break;
    case 'del': deleteJob(el); break;
    case 'copyquote': copyQuote(); break;
    case 'usecalc': { const p = $('#jobForm [name=price]'); if (p) p.value = el.dataset.total; break; }
    case 'dlstl': downloadStl(el.dataset.path); break;
    case 'newproduct': openProduct(null); break;
    case 'editproduct': openProduct(id); break;
    case 'delproduct': deleteProduct(el); break;
    case 'signout': await sb.auth.signOut(); location.reload(); break;
  }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const id = e.target.id;
  if (id === 'loginForm') submitLogin(e.target);
  else if (id === 'jobForm') submitJob(e.target);
  else if (id === 'productForm') submitProduct(e.target);
  else if (id === 'ratesForm') submitRates(e.target);
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { ui.q = e.target.value; renderView(); return; }
  if (e.target.closest('#jobForm') && e.target.matches('[name=material],[name=qty],[name=extras],[name=weight_g],[name=hours]')) updateCalc();
});
document.addEventListener('change', e => { if (e.target.closest('#jobForm') && e.target.matches('[name=material]')) updateCalc(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modal').hidden) { closeModal(); return; }
  if (e.key === 'Tab' && !$('#modal').hidden) {
    const f = [...$('#panel').querySelectorAll('button:not([disabled]),input:not([type=hidden]),select,textarea:not([hidden])')].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }
});

/* ---------- boot ---------- */
(async () => {
  if (!sb) {
    $('#app').innerHTML = '<div class="login"><h2>Not connected yet</h2><p class="muted">Open config.js and add your Supabase address and key. The README explains how.</p></div>';
    return;
  }
  const {data} = await sb.auth.getSession();
  await handleSession(data.session);
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.reload(); });
})();
})();
