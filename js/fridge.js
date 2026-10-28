// 冷蔵庫の食材から探す(シート)。v1 の fridge.js から移植
// 冷蔵庫にある食材を入れると、登録済みのレシピを「すぐ作れる → 足りないものが少ない」順に並べる
// 検索の中身(recipeNeeds / searchByFridge / keyMatches …)は lib/ingredients.js にある。入れた食材は端末に保存(ボックスに依らない)
import { store } from './store.js';
import * as ui from './ui.js';
import { el, norm } from './lib/text.js';
import { ingKey, stripNote, knownIngredients, effectiveStaples, searchByFridge } from './lib/ingredients.js';
import { heroImage } from './lib/image.js';
import { openDetail } from './recipe-detail.js';
import { addToShop } from './shop.js';
import { openSettings } from './settings.js';

const MAX_ITEMS = 60;
const fridge = {
  items: [], // 入れた食材の名前
  seasonOk: true, // 調味料は家にあるものとして探す
};
let ov;
const n = {}; // 画面の部品

function loadPrefs() {
  const raw = store.prefs.get('fridge', []);
  fridge.items = Array.isArray(raw) ? raw.map((x) => String(x)).filter(Boolean).slice(0, MAX_ITEMS) : [];
  fridge.seasonOk = store.prefs.get('fridgeSeasonOk', true) !== false;
}
function savePrefs() {
  store.prefs.set('fridge', fridge.items);
  store.prefs.set('fridgeSeasonOk', fridge.seasonOk);
}

export function init() {
  loadPrefs();
  ov = ui.sheet({ id: 'fridge', title: '食材から探す', eyebrow: '登録済みのレシピから', build });
  // 開いている間にレシピ・よく使う食材・ボックスが変わったら描き直す
  const refresh = () => { if (ui.isOpen(ov)) render(); };
  ['recipes', 'settings', 'box', 'loaded'].forEach((ev) => store.on(ev, refresh));
}

export function openFridge(origin) {
  n.input.value = '';
  n.season.checked = fridge.seasonOk;
  render(true);
  ui.open(ov, origin);
}

function build(body) {
  body.innerHTML = `
    <form class="add-row" novalidate>
      <input maxlength="60" autocomplete="off" enterkeyhint="done" placeholder="冷蔵庫にある食材(例:卵 玉ねぎ)" aria-label="冷蔵庫にある食材">
      <button class="btn small" type="submit">追加</button>
    </form>
    <div class="fridge-suggest" hidden></div>
    <ul class="edit-chips fridge-chips" aria-label="入れた食材" hidden></ul>
    <section class="sec fridge-quick">
      <div class="sec-h-row"><h3 class="sec-h">よく使う食材</h3><button class="link small" type="button" data-edit-staples>編集</button></div>
      <div class="fridge-quick-list"></div>
      <p class="hint" data-quick-none hidden>よく使う食材はすべて入っています</p>
    </section>
    <label class="switch-row"><span>調味料は家にあるものとして探す</span><input type="checkbox" checked><span class="switch" aria-hidden="true"></span></label>
    <div class="fridge-results-head"><h3 class="sec-h" aria-live="polite"></h3><button class="link small" type="button" data-clear hidden>食材をすべて外す</button></div>
    <ul class="fridge-results"></ul>
    <p class="fridge-empty" hidden></p>`;
  n.form = body.querySelector('form');
  n.input = n.form.querySelector('input');
  n.suggest = body.querySelector('.fridge-suggest');
  n.chips = body.querySelector('.fridge-chips');
  n.quick = body.querySelector('.fridge-quick');
  n.quickList = body.querySelector('.fridge-quick-list');
  n.quickNone = body.querySelector('[data-quick-none]');
  n.season = body.querySelector('.switch-row input');
  n.count = body.querySelector('.fridge-results-head h3');
  n.clear = body.querySelector('[data-clear]');
  n.results = body.querySelector('.fridge-results');
  n.empty = body.querySelector('.fridge-empty');

  n.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = n.input.value;
    if (!v.trim()) return n.input.focus();
    // スペース・読点区切りでまとめて入れられる(例:「卵 玉ねぎ ピーマン」)
    v.split(/[\s　、,]+/).filter(Boolean).forEach(addItem);
  });
  n.input.addEventListener('input', renderSuggest);
  n.season.addEventListener('change', () => {
    fridge.seasonOk = n.season.checked;
    savePrefs();
    renderResults();
  });
  n.clear.addEventListener('click', () => {
    fridge.items = [];
    savePrefs();
    render();
  });
  body.querySelector('[data-edit-staples]').addEventListener('click', (e) => openSettings('staples', e.currentTarget));
}

/* ---------------- 入れた食材 ---------------- */
function addItem(raw) {
  const name = stripNote(String(raw).normalize('NFKC').trim()).slice(0, 20);
  if (!name) return;
  const key = ingKey(name);
  if (fridge.items.some((x) => ingKey(x) === key)) {
    ui.toast(`「${name}」はもう入っています`);
    return;
  }
  fridge.items = [...fridge.items, name].slice(-MAX_ITEMS);
  savePrefs();
  n.input.value = '';
  render();
}

function removeItem(name) {
  fridge.items = fridge.items.filter((x) => x !== name);
  savePrefs();
  render();
}

// ワンタップで入れるチップ(よく使う食材・入力中の候補)
function addChip(name) {
  const b = el('button', 'add-chip');
  b.type = 'button';
  b.innerHTML = ui.ICON.plus;
  b.append(el('span', null, name));
  b.setAttribute('aria-label', `「${name}」を入れる`);
  b.onclick = () => addItem(name);
  return b;
}

/* ---------------- 描画 ---------------- */
function render(animate) {
  // 入れた食材
  n.chips.innerHTML = '';
  fridge.items.forEach((name) => {
    const li = el('li');
    li.append(el('span', null, name));
    const del = el('button');
    del.type = 'button';
    del.innerHTML = ui.ICON.close;
    del.setAttribute('aria-label', `「${name}」を外す`);
    del.onclick = () => removeItem(name);
    li.append(del);
    n.chips.append(li);
  });
  n.chips.hidden = !fridge.items.length;
  n.clear.hidden = !fridge.items.length;

  // よく使う食材(まだ入れていないものだけ)
  const haveKeys = fridge.items.map((x) => ingKey(x));
  const staples = effectiveStaples(store.settings, store.recipes.list);
  const quick = staples.filter((name) => !haveKeys.includes(ingKey(name)));
  n.quickList.innerHTML = '';
  quick.forEach((name) => n.quickList.append(addChip(name)));
  // 全部入れ終わっても「編集」から変えられるよう、見出しは出したままにする
  n.quick.hidden = !staples.length && !Array.isArray(store.settings.staples);
  n.quickNone.hidden = !!quick.length;

  renderSuggest();
  renderResults(animate);
}

// 入力中の候補(登録済みレシピに出てくる食材から)
function renderSuggest() {
  n.suggest.innerHTML = '';
  const q = norm(n.input.value.trim());
  if (!q) { n.suggest.hidden = true; return; }
  const haveKeys = fridge.items.map((x) => ingKey(x));
  const list = knownIngredients(store.recipes.list)
    .filter((it) => !haveKeys.includes(it.key) && (norm(it.name).includes(q) || it.key.includes(q)))
    .sort((a, b) => (norm(a.name).startsWith(q) ? 0 : 1) - (norm(b.name).startsWith(q) ? 0 : 1) || b.count - a.count)
    .slice(0, 8);
  list.forEach((it) => n.suggest.append(addChip(it.name)));
  n.suggest.hidden = !list.length;
}

function renderResults(animate) {
  n.results.innerHTML = '';
  n.results.classList.toggle('animate', !!animate);
  const results = fridge.items.length ? searchByFridge(store.recipes.list, fridge.items, fridge.seasonOk) : [];
  const ready = results.filter((x) => !x.missing.length).length;
  n.count.textContent = !results.length ? ''
    : ready ? `すぐ作れる ${ready}品 · 候補 ${results.length}品` : `候補 ${results.length}品`;

  results.slice(0, 60).forEach((x, i) => {
    const li = el('li', 'fr-item' + (x.missing.length ? '' : ' ready'));
    li.style.setProperty('--i', Math.min(i, 12));
    const open = el('button', 'fr-main');
    open.type = 'button';
    const thumb = el('span', 'fr-thumb');
    const img = heroImage(x.r);
    if (img) thumb.append(img); else thumb.textContent = '🍽';
    const text = el('span', 'fr-text');
    text.append(el('b', null, x.r.name));
    // 主役は「足りないもの」。使う食材は補足として小さく
    if (x.missing.length) {
      const miss = el('span', 'fr-missing');
      miss.append(el('em', null, `あと${x.missing.length}つ`), x.missing.map((m) => m.name).join('・'));
      text.append(miss);
    } else {
      text.append(el('span', 'fr-ready', '材料がそろっています'));
    }
    text.append(el('span', 'fr-used', `使う食材:${x.used.map((m) => m.name).join('・')}`));
    open.append(thumb, text);
    // レシピはこのシートの上に開く(閉じると結果に戻れる)
    open.onclick = () => openDetail(x.r.id, { origin: open });
    li.append(open);
    if (x.missing.length) {
      const add = el('button', 'link small fr-add', '足りないものを買い物リストへ');
      add.type = 'button';
      add.onclick = () => addMissingToShop(add, x);
      li.append(add);
    }
    n.results.append(li);
  });

  const msg = !store.loaded ? ''
    : !store.recipes.list.length ? 'まだレシピがありません。レシピを登録すると、ここから探せます。'
      : !fridge.items.length ? '冷蔵庫にある食材を入れると、作れるレシピが出てきます。'
        : !results.length ? '入れた食材を使うレシピは見つかりませんでした。' : '';
  n.empty.textContent = msg;
  n.empty.hidden = !msg;
}

// 足りないものを買い物リストへ(重複は shop.js が除いて知らせる)
async function addMissingToShop(btn, x) {
  btn.disabled = true;
  try {
    await addToShop(x.missing.map((m) => ({
      key: m.key, name: m.name, amount: m.amount, recipes: [x.r.name], group: m.season ? 'season' : 'food',
    })));
  } finally {
    btn.disabled = false;
  }
}
