// 起動:設定値(firebase-config.js は index.html が先に読む)→ store の初期化 → 各モジュールの init →
// 上部バー・タブバー・追加ボタン → ゲート/起動画面 → タブ復元 → 共有メニューからの登録
import { store } from './store.js';
import * as ui from './ui.js';
import * as recipes from './recipes.js';
import * as recipeDetail from './recipe-detail.js';
import * as recipeForm from './recipe-form.js';
import * as cook from './cook.js';
import * as timers from './timers.js';
import * as pip from './pip.js';
import * as plan from './plan.js';
import * as today from './today.js';
import * as shop from './shop.js';
import * as fridge from './fridge.js';
import * as settings from './settings.js';
import * as sharing from './sharing.js';

const $ = (s) => document.querySelector(s);

/* ---------------- 共有メニューから開かれたとき(?share_text=…)。先に読んでから URL をきれいにする ---------------- */
const pendingShare = (() => {
  const p = new URLSearchParams(location.search);
  if (!['share_url', 'share_text', 'share_title'].some((k) => p.has(k))) return null;
  const all = ['share_url', 'share_text', 'share_title'].map((k) => p.get(k) || '').join(' ').trim();
  const url = (all.match(/https?:\/\/[^\s]+/) || [])[0] || '';
  const title = (p.get('share_title') || '').trim();
  history.replaceState(null, '', location.pathname);
  return { videoUrl: url, name: /^https?:\/\//.test(title) ? '' : title.slice(0, 80), memo: url ? '' : all };
})();

/* ---------------- store と各モジュール(決まった順に init) ---------------- */
store.init();
[timers, pip, cook, recipeDetail, recipeForm, recipes, today, plan, shop, fridge, settings, sharing].forEach((m) => m.init());

/* ---------------- 上部バー:ボックス名 ▾ / ≡(同期の点) ---------------- */
const boxBtn = $('#boxBtn');
const menuBtn = $('#menuBtn');
function renderBox() {
  $('#boxName').textContent = store.box.name;
  boxBtn.setAttribute('aria-label', `ボックス:${store.box.name}。切り替える`);
}
store.on('box', renderBox);
renderBox();
boxBtn.addEventListener('click', () => sharing.openBoxMenu(boxBtn));
menuBtn.addEventListener('click', () => settings.openSettings(null, menuBtn));

// 右上の点は、オフライン(注意色)とエラー(危険色)のときだけ
function renderSync() {
  const s = store.sync.state;
  $('#syncBadge').dataset.state = s;
  menuBtn.setAttribute('aria-label', s === 'offline' || s === 'error' ? `設定(${store.syncText().title})` : '設定');
}
store.on('sync', renderSync);
renderSync();

const topbar = $('#topbar');
const onScroll = () => topbar.classList.toggle('scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------------- タブバーのバッジ(未購入の数)と追加ボタン ---------------- */
function renderShopCount() {
  const n = store.shop.list.filter((s) => !s.checked).length;
  const c = $('#shopCount');
  c.hidden = !n;
  c.textContent = n > 99 ? '99+' : String(n);
}
store.on('shop', renderShopCount);
renderShopCount();
$('#fab').addEventListener('click', () => recipeForm.openForm());

/* ---------------- ゲート(Google ログイン / ログインせずに使う) ---------------- */
const gate = $('#gate');
const gateError = $('#gateError');
let gateTimer;
function showGate(error) {
  clearTimeout(gateTimer);
  gateError.textContent = error || '';
  gateError.hidden = !error;
  if (!gate.hidden) return;
  gate.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => gate.classList.add('open')));
}
function hideGate() {
  if (gate.hidden) return;
  gate.classList.remove('open');
  gateTimer = setTimeout(() => { gate.hidden = true; }, 320);
}
store.on('gate', ({ error } = {}) => showGate(error));
store.on('auth', (user) => { if (user) hideGate(); });
$('#gateSignIn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'ログインしています…';
  gateError.hidden = true;
  try {
    await store.signIn();
  } catch (err) {
    gateError.textContent = store.signInErrorText(err);
    gateError.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});
$('#gateLocal').addEventListener('click', () => {
  store.useLocal();
  hideGate();
});

/* ---------------- 起動画面(タップでホームへ。表示の判定は index.html の先頭で済ませてある) ---------------- */
const intro = $('#intro');
function dismissIntro() {
  if (intro.hidden || intro.classList.contains('out')) return;
  try { sessionStorage.setItem('rb2:intro', '1'); } catch { /* 保存できなくても進む */ }
  intro.classList.add('out');
  setTimeout(() => { intro.hidden = true; }, 520);
}
intro.addEventListener('click', dismissIntro);
intro.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dismissIntro(); }
});
if (!intro.hidden) intro.focus({ preventScroll: true });

/* ---------------- タブの復元(履歴の土台はレシピ画面) ---------------- */
ui.initTabs(store.prefs.get('tab', 'recipes'));

/* ---------------- 共有メニューから:読み込みが終わったら登録画面を開く ---------------- */
store.on('share', (preset) => recipeForm.openForm(null, preset));
if (pendingShare) {
  const off = store.on('loaded', () => { off(); store.emit('share', pendingShare); });
}

// 日付が変わったあとにアプリへ戻ってきたときなど、画面を更新したいモジュールのために知らせる
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') store.emit('visible');
});

/* ---------------- アプリ化(PWA) ---------------- */
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  store.install = e;
  store.emit('install', e);
});
window.addEventListener('appinstalled', () => {
  store.install = null;
  store.emit('install', null);
  ui.toast('ホーム画面に追加しました');
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン対応なしでも動く */ });
}
