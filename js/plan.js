// 献立タブ(#view-plan):期間、設定で選んだ食事の枠、レシピ選択シート、1品シート、「献立に追加」シート、まとめ(買い物リストを作る)
// ロジックは v1 の plan.js から移植。見た目は css/plan.css(v2 の設計)。合算は lib/ingredients の buildShopping
import { store, MEALS, normalizeEntry, normalizeShopItem } from './store.js';
import * as ui from './ui.js';
import { el, uid, clamp, dayFromToday, fmtDay, relDay, WEEKDAYS } from './lib/text.js';
import { buildShopping } from './lib/ingredients.js';
import { matches } from './lib/search.js';
import { heroImage } from './lib/image.js';
import { openDetail } from './recipe-detail.js';

const PERIODS = [[3, '3日'], [7, '1週間'], [14, '2週間']];
const SLOT_DAYS = 14; // 「献立に追加」で選べる日数
const mealOf = (id) => MEALS.find((m) => m.id === id) || MEALS[2];
const getRecipe = (id) => store.recipes.get(id);
const slotEntries = (date, meal) => store.plan.list.filter((e) => e.date === date && e.meal === meal);
const planRange = () => ({ from: dayFromToday(0), to: dayFromToday(planDays - 1) });
function planInRange() {
  const { from, to } = planRange();
  return store.plan.list.filter((e) => e.date >= from && e.date <= to);
}
// 写真(無ければ動画のサムネイル)を入れた枠。無ければ絵文字、レシピが無ければ「?」
function thumbOf(r, cls) {
  const t = el('span', cls);
  const img = r && heroImage(r);
  if (img) t.append(img); else t.textContent = r ? '🍽' : '?';
  return t;
}
function stepper(onStep) {
  const box = el('div', 'stepper');
  const minus = el('button', null, '−');
  minus.type = 'button';
  minus.setAttribute('aria-label', '減らす');
  minus.onclick = () => onStep(-1);
  const val = el('span');
  const plus = el('button', null, '＋');
  plus.type = 'button';
  plus.setAttribute('aria-label', '増やす');
  plus.onclick = () => onStep(1);
  box.append(minus, val, plus);
  return { box, minus, val, plus, paint(n) { val.textContent = `${n}人分`; minus.disabled = n <= 1; plus.disabled = n >= 20; } };
}

let planDays = 7;
const justAdded = new Set(); // 追加した直後の1品だけ、ふわっと出す
let fresh = true; // 読み込み後の最初の描画は日付カードを順に出す
let periodBox, daysBox, countEl, rangeEl, makeBtn;
let pickOv, entryOv, slotOv;

export function init() {
  planDays = store.prefs.get('planDays', 7);
  if (!PERIODS.some(([d]) => d === planDays)) planDays = 7;

  const view = document.getElementById('view-plan');
  const head = el('div', 'plan-head');
  head.append(el('h1', null, '献立'));
  periodBox = el('div', 'segmented');
  periodBox.setAttribute('role', 'group');
  periodBox.setAttribute('aria-label', '期間');
  PERIODS.forEach(([d, label]) => {
    const b = el('button', null, label);
    b.type = 'button';
    b.dataset.days = d;
    b.onclick = () => {
      if (planDays === d) return;
      planDays = d;
      store.prefs.set('planDays', d);
      renderPlan(true);
    };
    periodBox.append(b);
  });
  head.append(periodBox);

  const summary = el('section', 'plan-summary');
  summary.setAttribute('aria-live', 'polite');
  const text = el('div', 'ps-text');
  countEl = el('b');
  rangeEl = el('span');
  text.append(countEl, rangeEl);
  makeBtn = el('button', 'btn primary', '買い物リストを作る');
  makeBtn.type = 'button';
  makeBtn.disabled = true;
  makeBtn.onclick = makeList;
  summary.append(text, makeBtn);

  daysBox = el('div', 'plan-days');
  view.append(head, summary, daysBox);

  pickOv = ui.sheet({ id: 'plan-pick', build: buildPicker });
  entryOv = ui.sheet({ id: 'plan-entry', build: buildEntry });
  slotOv = ui.sheet({ id: 'plan-slot', eyebrow: '献立に追加', build: buildSlot });

  ['plan', 'recipes', 'settings'].forEach((ev) => store.on(ev, onData));
  store.on('shop', () => { if (ui.getTab() === 'plan' && store.loaded) renderSummary(planInRange()); });
  // ボックスが切り替わったらデータが入れ替わるので、開いているシートは閉じる
  store.on('box', () => {
    fresh = true;
    [pickOv, entryOv, slotOv].forEach((o) => { if (ui.isOpen(o)) ui.close(o); });
  });
  // 日付が変わったあとにアプリへ戻ってきたとき
  store.on('visible', () => { if (ui.getTab() === 'plan' && store.loaded) renderPlan(false); });
  ui.onTab((tab) => { if (tab === 'plan') renderPlan(true); });
}

// 献立・レシピ・設定が変わったとき(ほかの端末やメンバーの変更も含む)
function onData() {
  if (ui.getTab() === 'plan') renderPlan(fresh);
  if (!store.loaded) return;
  if (ui.isOpen(pickOv)) renderPicker();
  if (ui.isOpen(slotOv)) renderSlot();
  if (ui.isOpen(entryOv)) {
    const e = store.plan.get(entryId);
    if (e) entryServ.paint(e.servings); else ui.close(entryOv);
  }
}

/* ---------------- 献立タブ ---------------- */
function renderPlan(animate) {
  periodBox.querySelectorAll('button').forEach((b) => {
    const on = +b.dataset.days === planDays;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  daysBox.innerHTML = '';
  // 読み込み前(起動直後・ボックス切り替え直後)は空の献立を見せない
  if (!store.loaded) {
    countEl.textContent = '';
    rangeEl.textContent = '';
    makeBtn.disabled = true;
    return;
  }
  if (animate) fresh = false;
  daysBox.classList.toggle('animate', !!animate);
  const entries = planInRange();
  const meals = store.settings.meals;

  for (let i = 0; i < planDays; i++) {
    const date = dayFromToday(i);
    const day = el('section', 'plan-day');
    day.style.setProperty('--i', Math.min(i, 8));
    const head = el('header', 'pd-head');
    head.append(el('span', 'pd-date', fmtDay(date)));
    const rel = relDay(date);
    if (rel) head.append(el('span', 'pd-rel', rel));
    day.append(head);

    // 設定で選んだ食事の枠。料理が入っている枠は設定でオフでも出す
    MEALS.filter((m) => meals.includes(m.id) || entries.some((e) => e.date === date && e.meal === m.id)).forEach((m) => {
      const row = el('div', 'plan-meal');
      row.append(el('span', 'plan-meal-label', m.label));
      const list = el('div', 'plan-meal-dishes');
      entries
        .filter((e) => e.date === date && e.meal === m.id)
        .sort((a, b) => a.createdAt - b.createdAt)
        .forEach((e) => list.append(dishChip(e)));
      const add = el('button', 'plan-meal-add');
      add.type = 'button';
      add.innerHTML = ui.ICON.plus;
      add.setAttribute('aria-label', `${fmtDay(date)}の${m.long}にレシピを追加`);
      add.onclick = () => openPicker(date, m.id, add);
      list.append(add);
      row.append(list);
      day.append(row);
    });
    daysBox.append(day);
  }
  justAdded.clear();
  renderSummary(entries);
}

function dishChip(e) {
  const r = getRecipe(e.recipeId);
  const b = el('button', 'plan-dish' + (r ? '' : ' missing') + (justAdded.has(e.id) ? ' pop' : ''));
  b.type = 'button';
  const name = r ? r.name : '削除されたレシピ';
  b.append(thumbOf(r, 'plan-dish-thumb'), el('span', 'plan-dish-name', name), el('span', 'plan-dish-serv', `${e.servings}人`));
  b.title = name;
  b.onclick = () => openEntry(e.id, b);
  return b;
}

// まとめ:「N品 · 材料 M点」「期間」「買い物リストを作る/更新」。削除されたレシピは集計から除く
function renderSummary(entries) {
  const valid = entries.filter((e) => getRecipe(e.recipeId));
  const items = buildShopping(valid, getRecipe);
  const { from, to } = planRange();
  countEl.textContent = valid.length ? `${valid.length}品 · 材料 ${items.length}点` : '献立はまだ空です';
  rangeEl.textContent = `${fmtDay(from)} 〜 ${fmtDay(to)}`;
  makeBtn.disabled = !valid.length;
  makeBtn.textContent = store.shop.list.some((s) => s.source === 'plan') ? '買い物リストを更新' : '買い物リストを作る';
}

/* ---------------- 献立 → 買い物リスト ---------------- */
// 作り直すと、献立から作った未購入の項目を入れ替える。買ったもの・自分で追加したものはそのまま
async function makeList() {
  const items = buildShopping(planInRange(), getRecipe);
  if (!items.length) return ui.toast('献立のレシピに材料が登録されていません');
  const shop = store.shop.list;
  const fromPlan = shop.filter((s) => s.source === 'plan');
  const bought = new Set(fromPlan.filter((s) => s.checked).map((s) => s.key));
  const manualKeys = new Set(shop.filter((s) => s.source === 'manual' && !s.checked).map((s) => s.key));
  const ops = fromPlan.filter((s) => !s.checked).map((s) => ({ type: 'del', id: s.id }));
  const now = Date.now();
  let added = 0;
  items.forEach((it, i) => {
    if (bought.has(it.key) || manualKeys.has(it.key)) return;
    ops.push({ type: 'put', d: normalizeShopItem({ ...it, id: uid(), source: 'plan', checked: false, createdAt: now + i }) });
    added++;
  });
  makeBtn.disabled = true; // 二重押し防止(描き直しで戻る)
  const ok = await store.shop.batch(ops);
  makeBtn.disabled = false;
  if (!ok) return;
  ui.goTab('shop');
  ui.toast(`${added}点を買い物リストに入れました`);
}

/* ---------------- レシピを選ぶ(その日の朝・昼・晩に入れる) ---------------- */
const pick = { date: '', meal: 'dinner', course: 'all' };
let pickQ, pickChips, pickList, pickEmpty;
let pickAnimate = false; // 開いたときと絞り込みを変えたときだけ、行を順に出す

function buildPicker(body) {
  const tools = el('div', 'pick-tools');
  const search = el('div', 'pick-search');
  search.innerHTML = ui.ICON.search;
  pickQ = el('input');
  pickQ.type = 'search';
  pickQ.placeholder = '料理名・材料で探す';
  pickQ.autocomplete = 'off';
  pickQ.enterKeyHint = 'search';
  pickQ.setAttribute('aria-label', 'レシピを探す');
  pickQ.addEventListener('input', () => { pickAnimate = true; renderPicker(); });
  search.append(pickQ);
  pickChips = el('div', 'chips pick-chips');
  tools.append(search, pickChips);
  pickList = el('ul', 'pick-list');
  pickEmpty = el('p', 'pick-empty');
  pickEmpty.hidden = true;
  const foot = el('div', 'pick-foot');
  const done = el('button', 'btn primary wide', '完了');
  done.type = 'button';
  done.dataset.close = '';
  foot.append(done);
  body.append(tools, pickList, pickEmpty, foot);
}

function openPicker(date, meal, origin) {
  pick.date = date;
  pick.meal = meal;
  pick.course = 'all';
  pickQ.value = '';
  pickAnimate = true;
  renderPicker();
  ui.open(pickOv, origin);
}

function renderPicker() {
  const recipes = store.recipes.list;
  const inSlot = slotEntries(pick.date, pick.meal);
  pickOv.setTitle(`${fmtDay(pick.date)} ${mealOf(pick.meal).long}`, inSlot.length ? `${inSlot.length}品 選択中` : 'レシピを選んでください');

  // 種類で絞り込み(レシピで使われているものだけ)
  const courses = [...new Set([...store.settings.courses, ...recipes.map((r) => r.course)])].filter((c) => c && recipes.some((r) => r.course === c));
  if (pick.course !== 'all' && !courses.includes(pick.course)) pick.course = 'all';
  const chipScroll = pickChips.scrollLeft;
  pickChips.innerHTML = '';
  pickChips.hidden = !courses.length;
  courses.forEach((c) => {
    const b = el('button', 'chip' + (pick.course === c ? ' active' : ''), c);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(pick.course === c));
    b.onclick = () => { pick.course = pick.course === c ? 'all' : c; pickAnimate = true; renderPicker(); };
    pickChips.append(b);
  });
  pickChips.scrollLeft = chipScroll;

  const q = pickQ.value.trim();
  const list = recipes
    .filter((r) => pick.course === 'all' || r.course === pick.course)
    .filter((r) => !q || matches(r, { query: q }))
    // よく使うものを上に:お気に入り → よく作る → 評価 → 名前
    .sort((a, b) => b.favorite - a.favorite || b.cooked.length - a.cooked.length || b.rating - a.rating || a.name.localeCompare(b.name, 'ja'));

  // 描き直してもスクロール位置は保つ(途中の1品を押しても先頭に戻らない)
  const scroll = pickList.scrollTop;
  pickList.classList.toggle('animate', pickAnimate);
  pickAnimate = false;
  pickList.innerHTML = '';
  list.forEach((r, i) => {
    const added = inSlot.some((e) => e.recipeId === r.id);
    const li = el('li');
    li.style.setProperty('--i', Math.min(i, 10));
    const b = el('button', 'pick-item' + (added ? ' added' : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(added));
    const text = el('span', 'pick-text');
    text.append(el('b', null, r.name), el('span', null, [r.genre, r.course, r.time ? `${r.time}分` : ''].filter(Boolean).join(' · ')));
    const check = el('span', 'pick-check');
    check.innerHTML = added ? ui.ICON.check : ui.ICON.plus;
    b.append(thumbOf(r, 'pick-thumb'), text, check);
    b.onclick = () => togglePick(r);
    li.append(b);
    pickList.append(li);
  });
  pickList.scrollTop = scroll;

  pickEmpty.hidden = list.length > 0;
  pickEmpty.textContent = !store.loaded ? '読み込んでいます…'
    : recipes.length ? '条件に合うレシピがありません'
      : 'まだレシピがありません。レシピ画面の右下のボタンから追加してください。';
}

// 押すたびに追加/解除。画面は store のイベントで描き直される
async function togglePick(r) {
  const exist = slotEntries(pick.date, pick.meal).find((e) => e.recipeId === r.id);
  if (exist) {
    await store.plan.del(exist.id);
  } else {
    const e = normalizeEntry({ id: uid(), date: pick.date, meal: pick.meal, recipeId: r.id, servings: r.servings, createdAt: Date.now() });
    justAdded.add(e.id);
    await store.plan.put(e);
  }
}

/* ---------------- 献立の1品(人数の変更・外す・レシピを見る) ---------------- */
let entryId = null;
let entryThumb, entryMeta, entryServRow, entryServ, entryOpen;

function buildEntry(body) {
  const row = el('div', 'entry-recipe');
  entryThumb = el('span', 'entry-thumb');
  entryMeta = el('span', 'entry-meta');
  row.append(entryThumb, entryMeta);

  entryServRow = el('div', 'plan-line');
  entryServRow.append(el('span', null, '人数'));
  entryServ = stepper(stepEntry);
  entryServRow.append(entryServ.box);

  const actions = el('div', 'entry-actions');
  const remove = el('button', 'btn ghost danger', '献立から外す');
  remove.type = 'button';
  remove.onclick = removeEntry;
  entryOpen = el('button', 'btn primary', 'レシピを見る');
  entryOpen.type = 'button';
  entryOpen.onclick = openEntryRecipe;
  actions.append(remove, entryOpen);
  body.append(row, entryServRow, actions);
}

function openEntry(id, origin) {
  const e = store.plan.get(id);
  if (!e) return;
  entryId = id;
  const r = getRecipe(e.recipeId);
  entryOv.setTitle(r ? r.name : '削除されたレシピ', `${fmtDay(e.date)} ${mealOf(e.meal).long}`);
  entryThumb.innerHTML = '';
  const img = r && heroImage(r);
  if (img) entryThumb.append(img); else entryThumb.textContent = r ? '🍽' : '?';
  entryMeta.textContent = r
    ? [r.genre, r.course, r.time ? `${r.time}分` : '', `レシピは${r.servings}人分`].filter(Boolean).join(' · ')
    : 'このレシピはゴミ箱に入れられたか、削除されています';
  entryServRow.hidden = !r;
  entryOpen.hidden = !r;
  entryServ.paint(e.servings);
  ui.open(entryOv, origin);
}

async function stepEntry(d) {
  const e = store.plan.get(entryId);
  if (!e) return;
  const next = { ...e, servings: clamp(e.servings + d, 1, 20) };
  if (next.servings === e.servings) return;
  entryServ.paint(next.servings);
  await store.plan.put(next);
}

async function removeEntry() {
  const e = store.plan.get(entryId);
  ui.close(entryOv);
  if (!e || !(await store.plan.del(e.id))) return;
  // 買い物リストを作ったあとに献立を変えたときは、作り直せることを伝える
  ui.toast(store.shop.list.some((x) => x.source === 'plan' && !x.checked)
    ? '献立から外しました。買い物リストは「買い物リストを更新」で作り直せます'
    : '献立から外しました');
}

function openEntryRecipe() {
  const e = store.plan.get(entryId);
  ui.close(entryOv);
  // シートが閉じて履歴が戻ってから、献立の人数でレシピを開く
  if (e) setTimeout(() => openDetail(e.recipeId, { servings: e.servings }), 200);
}

/* ---------------- レシピ画面から「献立に追加」 ---------------- */
const slot = { recipeId: '', date: '', meal: 'dinner', servings: 2 };
let slotDays, slotMeals, slotNote, slotServ, slotAdd;

function buildSlot(body) {
  body.append(el('h3', 'sec-h', 'いつ'));
  slotDays = el('div', 'slot-days');
  slotDays.setAttribute('role', 'group');
  slotDays.setAttribute('aria-label', '日付');
  slotMeals = el('div', 'segmented wide slot-meals');
  slotMeals.setAttribute('role', 'group');
  slotMeals.setAttribute('aria-label', '朝・昼・晩');
  MEALS.forEach((m) => {
    const b = el('button', null, m.label);
    b.type = 'button';
    b.dataset.meal = m.id;
    b.onclick = () => { slot.meal = m.id; store.prefs.set('lastMeal', m.id); renderSlot(); };
    slotMeals.append(b);
  });
  slotNote = el('p', 'slot-note');
  const line = el('div', 'plan-line');
  line.append(el('span', null, '人数'));
  slotServ = stepper((d) => { slot.servings = clamp(slot.servings + d, 1, 20); renderSlot(); });
  line.append(slotServ.box);
  slotAdd = el('button', 'btn primary wide', '追加');
  slotAdd.type = 'button';
  slotAdd.onclick = addSlot;
  body.append(slotDays, slotMeals, slotNote, line, slotAdd);
}

// servings を渡すとその人数で(レシピ画面で換算中の人数)
export function openSlotPicker(recipeId, servings, origin) {
  const r = getRecipe(recipeId);
  if (!r) return;
  slot.recipeId = recipeId;
  slot.date = dayFromToday(0);
  const meals = store.settings.meals;
  const last = store.prefs.get('lastMeal', 'dinner');
  slot.meal = meals.includes(last) ? last : meals[meals.length - 1];
  slot.servings = clamp(+servings > 0 ? Math.round(+servings) : r.servings, 1, 20);
  slotOv.setTitle(r.name);
  buildSlotDays();
  renderSlot();
  ui.open(slotOv, origin);
}

// 今日から14日の日付ボタン。開くときに作り、選び直しでは作り直さない(横スクロールの位置を保つ)
function buildSlotDays() {
  slotDays.innerHTML = '';
  for (let i = 0; i < SLOT_DAYS; i++) {
    const date = dayFromToday(i);
    const b = el('button', 'slot-day');
    b.type = 'button';
    b.dataset.date = date;
    const d = new Date(date + 'T12:00:00');
    b.append(el('span', 'sd-top', relDay(date) || WEEKDAYS[d.getDay()]), el('b', null, `${d.getMonth() + 1}/${d.getDate()}`), el('span', 'sd-dot'));
    b.onclick = () => { slot.date = date; renderSlot(); };
    slotDays.append(b);
  }
}

function renderSlot() {
  const plan = store.plan.list;
  slotDays.querySelectorAll('.slot-day').forEach((b) => {
    const on = b.dataset.date === slot.date;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
    // その日にもう献立があれば小さな点で知らせる
    b.querySelector('.sd-dot').hidden = !plan.some((e) => e.date === b.dataset.date);
  });
  const meals = store.settings.meals;
  if (!meals.includes(slot.meal)) slot.meal = meals[meals.length - 1];
  slotMeals.hidden = meals.length < 2; // 使う食事が1つなら出さない
  slotMeals.querySelectorAll('button').forEach((b) => {
    b.hidden = !meals.includes(b.dataset.meal);
    const on = b.dataset.meal === slot.meal;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  slotServ.paint(slot.servings);

  // 同じ枠にもう入っている料理を見せ、同じレシピの重複は防ぐ
  const inSlot = slotEntries(slot.date, slot.meal);
  const names = inSlot.map((e) => (getRecipe(e.recipeId) || {}).name).filter(Boolean);
  const dup = inSlot.some((e) => e.recipeId === slot.recipeId);
  const meal = mealOf(slot.meal).long;
  slotNote.textContent = dup
    ? `この日の${meal}には、すでに入っています`
    : names.length ? `この日の${meal}:${names.join('、')}` : `${meal}に追加します`;
  slotNote.classList.toggle('warn', dup);
  slotAdd.disabled = dup;
}

async function addSlot() {
  const e = normalizeEntry({ id: uid(), date: slot.date, meal: slot.meal, recipeId: slot.recipeId, servings: slot.servings, createdAt: Date.now() });
  justAdded.add(e.id);
  slotAdd.disabled = true;
  const ok = await store.plan.put(e);
  slotAdd.disabled = false;
  if (!ok) return;
  ui.close(slotOv);
  ui.toast(`${fmtDay(slot.date)} ${mealOf(slot.meal).long}に追加しました`);
}
