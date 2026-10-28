// 画面の部品:ページ・シートの生成と開閉(履歴連動)、通知、メニュー、FLIP、タブ切り替え、追加ボタン
// 開閉と「戻る」の仕組みは v1 の app.js(openOverlay / closeOverlay / popstate)と plan.js(goTab)から移植
import { el, replay, emitter } from './lib/text.js';

/* ---------------- 共通アイコン(SVG 文字列) ---------------- */
export const ICON = {
  // 三角形の重心((左辺x×2 + 先端x) / 3)が中心の 12 に来る形
  play: '<svg viewBox="0 0 24 24"><path d="M7.75 5.4v13.2a1 1 0 0 0 1.52.85l10.73-6.6a1 1 0 0 0 0-1.7L9.27 4.55a1 1 0 0 0-1.52.85z" fill="currentColor"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4.5 7.2 4.5c2 0 3.5 1.1 4.8 2.8 1.3-1.7 2.8-2.8 4.8-2.8 3.3 0 5.6 3.1 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1 6L12 17l-5.4 2.85 1-6L3.3 9.6l6-.9z"/></svg>',
  timer: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13.5" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 9.5v4l2.5 1.8M10 2.5h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v4.5A1.5 1.5 0 0116.5 20h-11A1.5 1.5 0 014 18.5v-11A1.5 1.5 0 015.5 6H10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chef: '<svg viewBox="0 0 24 24"><path d="M7 14.5a4 4 0 01-.9-7.9A5 5 0 0112 3a5 5 0 015.9 3.6 4 4 0 01-.9 7.9V20H7z M7 17h10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  resume: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9.5 3.5h5M6 7l.9 12.6A1.5 1.5 0 0 0 8.4 21h7.2a1.5 1.5 0 0 0 1.5-1.4L18 7M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4.5 19.5h4l10.3-10.3a2.83 2.83 0 0 0-4-4L4.5 15.5zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 3.5v11M8 7.5l4-4 4 4M7 11H6a1.5 1.5 0 00-1.5 1.5v6A1.5 1.5 0 006 20h12a1.5 1.5 0 001.5-1.5v-6A1.5 1.5 0 0018 11h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  person: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="4" fill="currentColor"/><path d="M4 20c1.2-4 4.4-6 8-6s6.8 2 8 6z" fill="currentColor"/></svg>',
  fridge: '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="5.5" y="2.5" width="13" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5.5 10h13M9 6v1.5M9 13v2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  filter: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

// アイコン付きボタン。icon は ICON のキー、label は右に添える文字
export function iconBtn(cls, icon, label) {
  const b = el('button', cls);
  b.type = 'button';
  b.innerHTML = ICON[icon] || '';
  if (label) b.append(label);
  return b;
}

/* ---------------- ページ・シート(overlay) ---------------- */
const stack = []; // 開いた順(最後がいちばん上)
const focusStack = [];
let ignorePop = 0;
let zTop = 50;

function wrap(kind, { id, onClose, onBack }) {
  const ov = el('div', `overlay ov-${kind}`);
  ov.id = id;
  ov.setAttribute('aria-hidden', 'true');
  ov._kind = kind;
  ov._onClose = onClose || null;
  ov._onBack = onBack || null;
  ov._steps = [];
  document.getElementById('overlays').append(ov);
  ov.addEventListener('click', (e) => {
    if (e.target === ov && kind === 'sheet') return close(ov); // シートは外側を押しても閉じる
    if (e.target.closest('[data-close]')) close(ov);
  });
  return ov;
}

// 全画面ページ。head:false で見出し行なし(自分で ‹ を置く。data-close を付ければ閉じる)
// 戻り値の ov には body / panel / titleEl / tools / setTitle(text) が付く
export function page({ id, title = '', build, onClose, onBack, head = true }) {
  const ov = wrap('page', { id, onClose, onBack });
  const sec = el('section', 'page');
  sec.setAttribute('role', 'dialog');
  sec.setAttribute('aria-modal', 'true');
  if (head) {
    const h = el('header', 'page-head');
    const back = el('button', 'back-btn');
    back.type = 'button';
    back.dataset.close = '';
    back.setAttribute('aria-label', '閉じる');
    back.innerHTML = ICON.back;
    const t = el('h2', 'page-title', title);
    t.id = `${id}-title`;
    const tools = el('div', 'page-tools');
    h.append(back, t, tools);
    sec.append(h);
    sec.setAttribute('aria-labelledby', t.id);
    ov.titleEl = t;
    ov.tools = tools;
  }
  const body = el('div', 'page-body');
  sec.append(body);
  ov.append(sec);
  ov.panel = sec;
  ov.body = body;
  ov.setTitle = (s) => { if (ov.titleEl) ov.titleEl.textContent = s; };
  if (build) build(body, ov);
  return ov;
}

// 下から出る小さめの画面。eyebrow は題名の上の小さな文字
// 戻り値の ov には body / panel / titleEl / eyebrowEl / setTitle(text, eyebrow?) が付く
export function sheet({ id, title = '', eyebrow = '', build, onClose, onBack, closeBtn = true }) {
  const ov = wrap('sheet', { id, onClose, onBack });
  const sec = el('section', 'sheet');
  sec.setAttribute('role', 'dialog');
  sec.setAttribute('aria-modal', 'true');
  const h = el('header', 'sheet-head');
  const text = el('div', 'head-text');
  const eb = el('p', 'eyebrow', eyebrow);
  eb.hidden = !eyebrow;
  const t = el('h2', 'sheet-title', title);
  t.id = `${id}-title`;
  text.append(eb, t);
  h.append(text);
  if (closeBtn) {
    const x = el('button', 'icon-btn');
    x.type = 'button';
    x.dataset.close = '';
    x.setAttribute('aria-label', '閉じる');
    x.innerHTML = ICON.close;
    h.append(x);
  }
  const body = el('div', 'sheet-body');
  sec.append(h, body);
  sec.setAttribute('aria-labelledby', t.id);
  ov.append(sec);
  ov.panel = sec;
  ov.body = body;
  ov.titleEl = t;
  ov.eyebrowEl = eb;
  ov.setTitle = (s, e) => { t.textContent = s; if (e != null) { eb.textContent = e; eb.hidden = !e; } };
  if (build) build(body, ov);
  return ov;
}

export const isOpen = (ov) => ov.getAttribute('aria-hidden') === 'false';
export const topOverlay = () => stack[stack.length - 1] || null;

// 画面を開く。origin(押したボタン)を渡すと、シートはそこから広がる。履歴を1つ積む
export function open(ov, origin) {
  if (isOpen(ov)) return;
  focusStack.push(document.activeElement);
  stack.push(ov);
  ov.style.zIndex = String(++zTop);
  history.pushState({ ov: ov.id, tab }, '');
  ov._hist = true;
  ov._steps = [];
  const panel = ov.panel;
  if (origin && ov._kind === 'sheet') {
    const r = origin.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    panel.style.transformOrigin = `${cx - panel.offsetLeft}px ${cy - panel.offsetTop + ov.scrollTop}px`;
  } else {
    panel.style.transformOrigin = '';
  }
  ov.scrollTop = 0;
  ov.setAttribute('aria-hidden', 'false');
  document.body.classList.add('locked');
  // 閉じた状態を一度描いてから開くと、最初のコマが飛ばずに滑らかに出てくる
  ov._raf = requestAnimationFrame(() => {
    ov._raf = requestAnimationFrame(() => ov.classList.add('open'));
  });
}

// ボタンで閉じるとき。積んだ履歴も戻して、「戻る」と食い違わないようにする。上に乗っている画面も一緒に閉じる
export function close(ov) {
  if (!isOpen(ov)) return;
  const at = stack.lastIndexOf(ov);
  const above = at >= 0 ? stack.slice(at) : [ov];
  const n = above.filter((o) => o._hist).reduce((s, o) => s + 1 + o._steps.length, 0);
  const top = stack[stack.length - 1];
  if (n && history.state && top && history.state.ov === top.id) {
    ignorePop++;
    history.go(-n);
  }
  above.reverse().forEach(closeNow);
}

// 履歴に触れずに閉じる(popstate から呼ぶ)
export function closeNow(ov) {
  if (!isOpen(ov)) return;
  ov._hist = false;
  ov._steps = [];
  const at = stack.lastIndexOf(ov);
  if (at >= 0) stack.splice(at, 1);
  if (!stack.length) zTop = 50;
  cancelAnimationFrame(ov._raf);
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
  if (!stack.length) document.body.classList.remove('locked');
  if (ov._onClose) ov._onClose();
  const f = focusStack.pop();
  if (f && f.focus) f.focus({ preventScroll: true });
}

// 画面の中の段階(設定の一覧 → 各項目)を履歴に積む。「戻る」で onBack() が呼ばれる
export function pushStep(ov, onBack) {
  if (!isOpen(ov)) return;
  history.pushState({ ov: ov.id, tab, step: ov._steps.length + 1 }, '');
  ov._steps.push(onBack || null);
}
export const back = () => history.back();

// スマホの「戻る」:いちばん上の画面の段階を1つ戻す → 画面を閉じる → 画面が無ければタブを戻す
window.addEventListener('popstate', (e) => {
  if (ignorePop > 0) { ignorePop--; return; }
  closeMenu();
  const top = [...stack].reverse().find((o) => o._hist);
  if (top) {
    if (top._steps.length) {
      const fn = top._steps.pop();
      if (fn) fn();
      return;
    }
    if (top._onBack && top._onBack()) return;
    closeNow(top);
    return;
  }
  onHistoryTab((e.state && e.state.tab) || 'recipes');
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (menuOpen) return closeMenu();
  const top = topOverlay();
  if (top) close(top);
});

/* ---------------- 通知 ---------------- */
let toastTimer;
// action = { label: '元に戻す', run() {} } を渡すと、通知にボタンが付く(少し長めに表示)
export function toast(msg, action) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('has-action', !!action);
  if (action) {
    const b = el('button', 'toast-action', action.label);
    b.type = 'button';
    b.onclick = () => { t.classList.remove('show'); clearTimeout(toastTimer); action.run(); };
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2200);
}

/* ---------------- メニュー(押した場所の近くに出る) ---------------- */
let menuOpen = null;
// items: { label, sub?, icon?(SVG 文字列), selected?, danger?, disabled?, onSelect } | { header: '…' } | { sep: true }
export function menu(anchor, items, { align } = {}) {
  // 同じボタンをもう一度押したら閉じるだけ
  if (menuOpen && menuOpen.anchor === anchor) { closeMenu(); return null; }
  closeMenu();
  const m = el('div', 'menu');
  m.setAttribute('role', 'menu');
  items.forEach((it) => {
    if (it.sep) return m.append(el('div', 'menu-sep'));
    if (it.header) return m.append(el('div', 'menu-head', it.header));
    const b = el('button', 'menu-item' + (it.selected ? ' selected' : '') + (it.danger ? ' danger' : ''));
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    if (it.icon) b.insertAdjacentHTML('beforeend', it.icon);
    const text = el('span', 'menu-text');
    text.append(el('span', 'menu-label', it.label));
    if (it.sub) text.append(el('span', 'menu-sub', it.sub));
    b.append(text);
    if (it.selected) { const mk = el('span', 'menu-mark'); mk.innerHTML = ICON.check; b.append(mk); }
    if (it.disabled) b.disabled = true;
    b.onclick = () => { closeMenu(); if (it.onSelect) it.onSelect(); };
    m.append(b);
  });
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  const right = align === 'right' || (align !== 'left' && r.left + w > innerWidth - 12);
  const x = right ? Math.max(12, r.right - w) : Math.max(12, Math.min(r.left, innerWidth - w - 12));
  let y = r.bottom + 6, up = false;
  if (y + h > innerHeight - 12) { y = Math.max(12, r.top - h - 6); up = true; }
  m.style.left = `${x}px`;
  m.style.top = `${y}px`;
  m.style.transformOrigin = `${right ? 'right' : 'left'} ${up ? 'bottom' : 'top'}`;
  requestAnimationFrame(() => m.classList.add('open'));
  const onDown = (e) => { if (!m.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  document.addEventListener('pointerdown', onDown, true);
  anchor.setAttribute('aria-expanded', 'true');
  menuOpen = { el: m, anchor, onDown, close: closeMenu };
  return menuOpen;
}

export function closeMenu() {
  if (!menuOpen) return;
  const { el: m, anchor, onDown } = menuOpen;
  menuOpen = null;
  document.removeEventListener('pointerdown', onDown, true);
  anchor.setAttribute('aria-expanded', 'false');
  m.classList.remove('open');
  setTimeout(() => m.remove(), 220);
}
window.addEventListener('resize', closeMenu);

/* ---------------- 動き ---------------- */
// FLIP:mutate() で並び順や表示が変わった子要素を、前の位置から新しい位置へ滑らかに移動。新しく現れた子はふわっと登場
// 同じ要素(ノード)を使い回すこと。hidden の子は対象外
export function flip(container, mutate, { duration = 560, enter = true, stagger = 45 } = {}) {
  const before = new Map();
  [...container.children].forEach((n) => { if (!n.hidden) before.set(n, n.getBoundingClientRect()); });
  mutate();
  let i = 0;
  [...container.children].forEach((n) => {
    if (n.hidden) return;
    const prev = before.get(n);
    const now = n.getBoundingClientRect();
    if (prev) {
      const dx = prev.left - now.left, dy = prev.top - now.top;
      if (dx || dy) n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration, easing: 'cubic-bezier(.2,.8,.2,1)' });
    } else if (enter) {
      n.animate(
        [{ opacity: 0, transform: 'translateY(24px) scale(.96)' }, { opacity: 1, transform: 'none' }],
        { duration: 650, delay: Math.min(i++, 12) * stagger, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }
      );
    }
  });
}

// 画面の中で高さが変わるとき、その下の要素(nodes)を高さのアニメーションではなく移動で追従させる
export function shift(nodes, change) {
  const list = nodes.filter(Boolean);
  const before = list.map((e) => e.getBoundingClientRect().top);
  change();
  list.forEach((e, i) => {
    const dy = before[i] - e.getBoundingClientRect().top;
    if (dy) e.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.32,.72,0,1)' });
  });
}

/* ---------------- タブ(下のタブバー) ---------------- */
const VIEWS = { recipes: '#view-recipes', plan: '#view-plan', shop: '#view-shop' };
let tab = 'recipes';
const tabEv = emitter();
export const getTab = () => tab;
// fn(tab, prev) — 切り替わったあとに呼ばれる(起動時の復元でも1回呼ぶ)
export const onTab = (fn) => tabEv.on('tab', fn);

function switchTab(t, instant) {
  if (!VIEWS[t]) t = 'recipes';
  const prev = tab;
  tab = t;
  try { localStorage.setItem('rb2:tab', JSON.stringify(t)); } catch { /* 保存できなくても動作は続ける */ }
  Object.entries(VIEWS).forEach(([k, sel]) => { document.querySelector(sel).hidden = k !== t; });
  document.body.dataset.tab = t;
  document.querySelectorAll('#tabbar .tab').forEach((b) => {
    const on = b.dataset.tab === t;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  moveTabIndicator(instant);
  if (prev !== t && !instant) {
    replay(document.querySelector(VIEWS[t]), 'view-in');
    window.scrollTo({ top: 0 });
  }
  tabEv.emit('tab', t, prev);
}

function moveTabIndicator(instant) {
  const active = document.querySelector('#tabbar .tab.active');
  const ind = document.querySelector('#tabbar .tab-ind');
  if (!active || !ind) return;
  ind.style.transition = instant ? 'none' : '';
  ind.style.width = `${active.offsetWidth}px`;
  ind.style.transform = `translateX(${active.offsetLeft}px)`;
  if (instant) { void ind.offsetWidth; ind.style.transition = ''; }
}

// タブの切り替えも「戻る」に対応させる(Android の標準どおり、献立・買い物から戻るとレシピへ)
export function goTab(t) {
  if (t === tab) return;
  const st = history.state || {};
  if (t === 'recipes') {
    if (st.tab && st.tab !== 'recipes' && !st.ov) { history.back(); return; } // popstate でレシピへ
    switchTab('recipes');
    history.replaceState({ tab: 'recipes' }, '');
  } else if (tab === 'recipes') {
    history.pushState({ tab: t }, '');
    switchTab(t);
  } else {
    history.replaceState({ tab: t }, '');
    switchTab(t);
  }
}

// 「戻る」で履歴が変わったとき
function onHistoryTab(t) {
  if (t !== tab) switchTab(t);
}

// 起動時に1回。履歴の土台はレシピ画面。前回ほかのタブで閉じていたら、その上に積んで開く
export function initTabs(initial) {
  history.replaceState({ tab: 'recipes' }, '');
  if (VIEWS[initial] && initial !== 'recipes') history.pushState({ tab: initial }, '');
  switchTab(initial, true);
  document.querySelectorAll('#tabbar .tab').forEach((b) => b.addEventListener('click', () => goTab(b.dataset.tab)));
  // どの画面からでも <button data-goto="plan"> で移動できる
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (b) goTab(b.dataset.goto);
  });
  window.addEventListener('resize', () => moveTabIndicator(true));
}

/* ---------------- 追加ボタン ---------------- */
// レシピタブ以外では CSS が自動でしまう。それ以外の理由で消したいときに使う
export function setFab(on) {
  document.body.classList.toggle('fab-hidden', !on);
}
