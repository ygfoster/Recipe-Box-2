// ホームの「今日の献立」(#today)。献立があれば料理の一覧(押すと献立の人数でレシピを開く)、
// なければ「まだ決まっていません → 献立を決める」の1行。v1 の plan.js の renderToday から移植
import { store, MEALS, MEAL_ORDER } from './store.js';
import * as ui from './ui.js';
import { el, dayFromToday, fmtDay } from './lib/text.js';
import { heroImage } from './lib/image.js';
import { openDetail } from './recipe-detail.js';

const mealOf = (id) => MEALS.find((m) => m.id === id) || MEALS[2];
let box;
let lastSig = ''; // 前回描いた内容。同じなら描き直さない(写真のちらつきを防ぐ)

export function init() {
  box = document.getElementById('today');
  box.classList.add('today');
  box.hidden = true;
  // 献立・レシピ・設定が変わったとき、読み込み後、ボックスの切り替え、アプリに戻ってきたとき(日付が変わる)
  ['plan', 'recipes', 'settings', 'loaded', 'box', 'visible'].forEach((ev) => store.on(ev, render));
}

function todayEntries(today) {
  return store.plan.list
    .filter((e) => e.date === today && store.recipes.get(e.recipeId))
    .sort((a, b) => MEAL_ORDER.indexOf(a.meal) - MEAL_ORDER.indexOf(b.meal) || a.createdAt - b.createdAt);
}

function render() {
  // 読み込み前や、レシピが1件も無いときは出さない(ホームの0件の案内に任せる)
  if (!store.loaded || !store.recipes.list.length) {
    box.hidden = true;
    box.innerHTML = '';
    lastSig = '';
    return;
  }
  const today = dayFromToday(0);
  const entries = todayEntries(today);
  const sig = [today, store.settings.meals.join(','), ...entries.map((e) => {
    const r = store.recipes.get(e.recipeId);
    return `${e.id}:${e.servings}:${r.name}|${r.time}|${r.photo ? r.photo.length : 0}|${r.videoUrl}`;
  })].join('\n');
  if (sig === lastSig && !box.hidden) return;
  lastSig = sig;

  box.innerHTML = '';
  box.hidden = false;
  const head = el('div', 'today-head');
  head.append(el('h2', null, '今日の献立'), el('span', 'today-date', fmtDay(today)));
  box.append(head);

  if (!entries.length) {
    // 決まっていないときは1行だけ。献立の画面へ
    const b = el('button', 'today-empty');
    b.type = 'button';
    const go = el('span', 'today-go', '献立を決める');
    go.insertAdjacentHTML('beforeend', ui.ICON.chevron);
    b.append(el('span', 'today-empty-text', 'まだ決まっていません'), go);
    b.onclick = () => ui.goTab('plan');
    box.append(b);
    return;
  }

  const ul = el('ul', 'today-list');
  // 食事の名前は、2つ以上の食事があるときだけ添える
  const showMeal = new Set(entries.map((e) => e.meal)).size > 1 || store.settings.meals.length > 1;
  entries.forEach((e) => {
    const r = store.recipes.get(e.recipeId);
    const li = el('li');
    const b = el('button', 'today-item');
    b.type = 'button';
    const thumb = el('span', 'today-thumb');
    const img = heroImage(r);
    if (img) thumb.append(img); else thumb.textContent = '🍽';
    const text = el('span', 'today-text');
    const meta = [showMeal ? mealOf(e.meal).long : '', `${e.servings}人分`, r.time ? `${r.time}分` : ''].filter(Boolean).join(' · ');
    text.append(el('b', null, r.name), el('span', null, meta));
    const chev = el('span', 'today-chev');
    chev.innerHTML = ui.ICON.chevron;
    b.append(thumb, text, chev);
    b.onclick = () => openDetail(e.recipeId, { servings: e.servings, origin: b });
    li.append(b);
    ul.append(li);
  });
  box.append(ul);
}
