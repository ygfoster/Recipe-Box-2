// 調理モード:全画面ページ。画面オン(Wake Lock)、材料のチェックと進捗バー、手順のチェック、手順のチップ(頭出し・タイマー)
// v1 の app.js(openCook / requestWake)から移植。チップは recipe-detail.js の stepChips を共用
import { store } from './store.js';
import * as ui from './ui.js';
import { el, lines, linkify } from './lib/text.js';
import { ingredientRows, parseStep } from './lib/ingredients.js';
import { stepChips } from './recipe-detail.js';

const BULB = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 3a6 6 0 00-3.6 10.8c.6.5 1 1.2 1 2V17h5.2v-1.2c0-.8.4-1.5 1-2A6 6 0 0012 3zM9.5 20h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const CHECK_SMALL = ui.ICON.check.replace('<svg', '<svg width="16" height="16"');

const cookChecks = new Map(); // レシピごとのチェック状態(アプリを開いている間は覚えておく)
let ov;
const C = {}; // 画面の部品
let cookId = null;
let wakeLock = null;

async function requestWake() {
  try {
    if (!('wakeLock' in navigator)) return;
    wakeLock = await navigator.wakeLock.request('screen');
    C.wake.classList.add('on');
    wakeLock.addEventListener('release', () => C.wake.classList.remove('on'));
  } catch { /* 省電力モードなどで取得できないことがある */ }
}
function releaseWake() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
  C.wake.classList.remove('on');
}

function build(body, o) {
  // 見出し行の右:画面オン(取得できたら成功色)
  C.wake = el('span', 'wake');
  C.wake.title = '調理中は画面が消えません';
  C.wake.innerHTML = BULB;
  C.wake.append('画面オン');
  o.tools.append(C.wake);

  C.eyebrow = el('p', 'eyebrow cook-eyebrow');
  const grid = el('div', 'cook-body');
  C.ingSec = el('section', 'cook-ing');
  const head = el('div', 'd-head');
  C.prog = el('span', 'c-prog');
  head.append(el('h3', null, '材料'), C.prog);
  C.progress = el('div', 'progress');
  C.bar = el('span');
  C.progress.append(C.bar);
  C.ing = el('ul', 'c-ing');
  C.ingSec.append(head, C.progress, C.ing);
  const stepSec = el('section', 'cook-steps');
  C.steps = el('ol', 'c-steps');
  stepSec.append(el('h3', null, '作り方'), C.steps);
  grid.append(C.ingSec, stepSec);
  body.append(C.eyebrow, grid);
}

export function init() {
  ov = ui.page({ id: 'cook', title: '', build, onClose: releaseWake });
  // アプリに戻ってきたら画面オンを取り直す(裏に回ると解放される)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ui.isOpen(ov)) requestWake();
  });
  // 作っているレシピが消えたら閉じる(ゴミ箱へ・ほかの端末で削除・ボックスの切り替え)
  store.on('recipes', ({ removed }) => {
    if (cookId && ui.isOpen(ov) && (removed.includes(cookId) || !store.recipes.get(cookId))) ui.close(ov);
  });
}

// 調理モードを開く。servings は詳細で選んでいた人数(材料をその人数に換算する)
export function openCook(id, servings) {
  const r = store.recipes.get(id);
  if (!r) return;
  cookId = id;
  const n = servings > 0 ? Math.round(servings) : r.servings;
  if (!cookChecks.has(id)) cookChecks.set(id, { ing: new Set(), steps: new Set() });
  const chk = cookChecks.get(id);
  ov.setTitle(r.name);
  C.eyebrow.textContent = `調理モード · ${n}人分`;

  // 材料:押すとチェック。全部そろうと緑になって知らせる
  C.ing.innerHTML = '';
  const rows = ingredientRows(r, n / r.servings);
  const total = rows.filter((x) => !x.header).length;
  const updateProg = (celebrate) => {
    const done = chk.ing.size;
    C.prog.textContent = total ? `${done} / ${total}` : '';
    C.bar.style.transform = `scaleX(${total ? done / total : 0})`;
    C.progress.classList.toggle('done', total > 0 && done === total);
    if (celebrate && total && done === total) ui.toast('材料がそろいました 👍');
  };
  rows.forEach((row, i) => {
    const li = el('li', row.header ? 'i-head' : null);
    if (row.header) { li.textContent = row.name; C.ing.append(li); return; }
    const key = `${i}:${row.name}`;
    const check = el('span', 'check');
    check.innerHTML = ui.ICON.check;
    li.append(check, el('span', 'c-name', row.name), el('span', 'c-amt', row.scaled));
    li.classList.toggle('done', chk.ing.has(key));
    li.onclick = () => {
      if (chk.ing.has(key)) chk.ing.delete(key); else chk.ing.add(key);
      li.classList.toggle('done', chk.ing.has(key));
      updateProg(chk.ing.has(key));
    };
    C.ing.append(li);
  });
  C.ingSec.hidden = !total;
  updateProg(false);

  // 手順:押すと番号が ✓ になる。チップ(頭出し・タイマー)はそのまま使える
  C.steps.innerHTML = '';
  const steps = lines(r.steps).map(parseStep);
  steps.forEach((s, i) => {
    const li = el('li');
    li.style.setProperty('--i', i);
    const num = el('span', 'num');
    const paint = () => { num.innerHTML = chk.steps.has(i) ? CHECK_SMALL : String(i + 1); };
    li.append(num, linkify(s.text));
    const chips = stepChips(r, s, true);
    if (chips.children.length) li.append(chips);
    li.classList.toggle('done', chk.steps.has(i));
    paint();
    li.onclick = (e) => {
      if (e.target.closest('a, button')) return;
      if (chk.steps.has(i)) chk.steps.delete(i); else chk.steps.add(i);
      li.classList.toggle('done', chk.steps.has(i));
      paint();
    };
    C.steps.append(li);
  });
  C.steps.parentElement.hidden = !steps.length;
  if (!steps.length && !total) {
    C.steps.parentElement.hidden = false;
    C.steps.append(el('li', 'c-none', '材料と作り方がまだ登録されていません'));
  }

  ui.open(ov);
  requestWake();
}
