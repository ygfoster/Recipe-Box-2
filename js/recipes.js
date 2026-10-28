// ホーム(レシピ一覧):検索と予測変換 → 「冷蔵庫の食材から探す」→ ジャンルのチップ + 絞り込み → 件数と条件 → 写真カード(FLIP)→ 0件の案内
// 絞り込みシート(種類・調理時間・お気に入り・並び替え)。条件は端末に保存。v1 の app.js(Grid / Search / Suggest / 絞り込み)から移植
import { store } from './store.js';
import * as ui from './ui.js';
import { el, replay } from './lib/text.js';
import { matches, suggestions, highlight, SORTS, SORT_OPTS, TIME_OPTS } from './lib/search.js';
import { heroImage } from './lib/image.js';
import { videoInfo } from './lib/video.js';
import { openDetail } from './recipe-detail.js';
import { openForm } from './recipe-form.js';
import { openFridge } from './fridge.js';

const state = { query: '', genre: 'all', course: 'all', fav: false, time: 0, sort: 'new', sugIndex: -1 };
const cardNodes = new Map(); // id → カード(同じノードを使い回して FLIP する)
const H = {}; // ホームの部品
const FS = {}; // 絞り込みシートの部品
let filterOv;
const labelOf = (opts, v) => (opts.find((o) => o.value === v) || opts[0]).label;

/* ---------------- ほかのモジュールへ ---------------- */
// 登録画面の初期値に使う(いま絞り込んでいるジャンル・種類)
export const currentFilter = () => ({ genre: state.genre, course: state.course });
// 検索語を入れて一覧を絞る(詳細のタグから)
export function setQuery(v) {
  H.q.value = v;
  state.query = v;
  H.search.classList.toggle('has-text', !!v);
  renderGrid();
}
// 保存した直後に一覧の先頭が見えるところまでスクロールする
export function revealList() {
  if (ui.getTab() !== 'recipes') return;
  window.scrollTo({ top: Math.max(0, H.filterRow.offsetTop - 80), behavior: 'smooth' });
}

/* ---------------- ホームの骨組み(#today の後ろに追加) ---------------- */
function buildHome() {
  const home = el('div', 'home');

  const top = el('div', 'home-top');
  H.search = el('div', 'search');
  const icon = el('span', 'search-icon');
  icon.innerHTML = ui.ICON.search;
  H.q = el('input');
  H.q.type = 'search';
  H.q.id = 'rq';
  H.q.placeholder = '料理名・材料・#タグで検索';
  H.q.autocomplete = 'off';
  H.q.spellcheck = false;
  H.q.setAttribute('role', 'combobox');
  H.q.setAttribute('aria-expanded', 'false');
  H.q.setAttribute('aria-controls', 'rsuggest');
  H.q.setAttribute('aria-autocomplete', 'list');
  H.q.setAttribute('aria-label', 'レシピを検索');
  H.clear = el('button', 'clear');
  H.clear.type = 'button';
  H.clear.setAttribute('aria-label', 'クリア');
  H.clear.innerHTML = ui.ICON.close;
  H.suggest = el('ul', 'suggest');
  H.suggest.id = 'rsuggest';
  H.suggest.setAttribute('role', 'listbox');
  H.search.append(icon, H.q, H.clear, H.suggest);
  H.fridgeBtn = ui.iconBtn('fridge-link', 'fridge', '冷蔵庫の食材から探す');
  H.fridgeBtn.onclick = () => openFridge(H.fridgeBtn);
  top.append(H.search, H.fridgeBtn);

  // 絞り込みは1行:ジャンル + 「絞り込み」(種類・時間・お気に入り・並び替えはシートで)
  H.filterRow = el('div', 'filter-row');
  H.genreChips = el('nav', 'chips');
  H.genreChips.setAttribute('aria-label', 'ジャンル');
  H.filterBtn = el('button', 'filter-btn');
  H.filterBtn.type = 'button';
  H.filterBtn.setAttribute('aria-label', '絞り込みと並び替え');
  H.filterBtn.innerHTML = ui.ICON.filter;
  H.filterN = el('b', 'filter-n');
  H.filterN.hidden = true;
  H.filterBtn.append(el('span', null, '絞り込み'), H.filterN);
  H.filterBtn.onclick = () => { renderFilterSheet(); ui.open(filterOv, H.filterBtn); };
  H.filterRow.append(H.genreChips, H.filterBtn);

  H.resultLine = el('div', 'result-line');
  H.count = el('span', 'count');
  H.activeFilters = el('span', 'active-filters');
  H.resultLine.append(H.count, H.activeFilters);

  H.grid = el('section', 'grid');
  H.grid.setAttribute('aria-label', 'レシピ');

  H.empty = el('section', 'empty');
  H.empty.hidden = true;
  H.emptyTitle = el('h2');
  H.emptyText = el('p');
  H.emptyAdd = el('button', 'btn primary', 'レシピを追加');
  H.emptyAdd.type = 'button';
  H.emptyAdd.onclick = () => openForm();
  H.empty.append(el('div', 'empty-icon', '🍳'), H.emptyTitle, H.emptyText, H.emptyAdd);

  home.append(top, H.filterRow, H.resultLine, H.grid, H.empty);
  document.getElementById('view-recipes').append(home);
}

/* ---------------- カード(写真が主役。料理名は写真の下部に重ねる) ---------------- */
function makeCard(r) {
  const card = el('article', 'card');
  card.tabIndex = 0;
  card.dataset.id = r.id;
  card.setAttribute('aria-label', r.name);
  const imgWrap = el('div', 'card-img');
  const img = heroImage(r);
  if (img) imgWrap.append(img); else card.classList.add('no-photo');
  if (videoInfo(r.videoUrl)) {
    const b = el('span', 'badge-play');
    b.innerHTML = ui.ICON.play;
    b.append('動画');
    imgWrap.append(b);
  }
  const fav = ui.iconBtn('fav' + (r.favorite ? ' on' : ''), 'heart');
  fav.setAttribute('aria-label', 'お気に入り');
  fav.setAttribute('aria-pressed', String(r.favorite));
  imgWrap.append(fav);

  const cap = el('div', 'card-cap');
  const meta = el('p', 'card-meta');
  meta.append(el('span', 'meta-text', [r.genre, r.course, r.time ? `${r.time}分` : ''].filter(Boolean).join(' · ')));
  if (r.rating) meta.append(el('span', 'mini-star', `★${r.rating}`));
  cap.append(el('h3', 'card-name', r.name), meta);
  card.append(imgWrap, cap);
  return card;
}

// 中身が変わったカードを、その場で差し替える(並び替えの前に行うと FLIP で「新しく現れた」扱いにならない)
function refreshCard(id) {
  const old = cardNodes.get(id);
  const r = store.recipes.get(id);
  if (!old || !r) return;
  const n = makeCard(r);
  n.hidden = old.hidden;
  n.querySelectorAll('img').forEach((i) => i.classList.add('loaded'));
  if (old.isConnected) old.replaceWith(n);
  cardNodes.set(id, n);
}

function renderGrid() {
  const list = [...store.recipes.list].sort(SORTS[state.sort] || SORTS.new);
  let visible = 0;
  // FLIP:残ったカードは新しい位置へ滑らかに移動、新しく現れたカードはふわっと登場
  ui.flip(H.grid, () => {
    list.forEach((r) => {
      let node = cardNodes.get(r.id);
      if (!node) {
        node = makeCard(r);
        cardNodes.set(r.id, node);
        // ゴミ箱へ入れた直後に「元に戻す」したときは、消える途中の古いカードがまだ残っているので先に外す
        [...H.grid.children].filter((n) => n !== node && n.dataset.id === r.id).forEach((n) => n.remove());
      }
      node.hidden = !matches(r, state);
      H.grid.append(node); // 並び順を反映
      if (!node.hidden) visible++;
    });
  });
  renderCount(visible);
  renderEmpty(visible);
}

function renderCount(n) {
  const total = store.loaded ? store.recipes.list.length : 0;
  H.count.textContent = total ? (n === total ? `${total}件` : `${n} / ${total}件`) : '';
  H.filterRow.hidden = !total;
  H.resultLine.hidden = !total;
  renderActiveFilters();
}

function renderEmpty(n) {
  // 読み込みが終わるまでは「0件」と見せない
  if (n || !store.loaded) { H.empty.hidden = true; return; }
  const was = !H.empty.hidden;
  H.empty.hidden = false;
  const none = !store.recipes.list.length;
  H.emptyTitle.textContent = none ? 'まだレシピがありません' : '見つかりませんでした';
  H.emptyText.textContent = none
    ? '写真や動画のURLと料理名を登録して、自分だけのレシピ帳をつくりましょう。'
    : state.query ? `「${state.query}」に一致するレシピはありません。` : 'この条件に合うレシピはまだありません。';
  H.emptyAdd.hidden = !none;
  if (!was) replay(H.empty, 'empty');
}

/* ---------------- 絞り込み(ジャンルの行・効いている条件) ---------------- */
// 絞り込みに出すのは、設定の選択肢 + 実際にレシピで使われているもの
// (store.settings は最初の読み込みまで空なので、無いときは空の配列として扱う)
const allGenres = () => [...new Set([...(store.settings.genres || []), ...store.recipes.list.map((r) => r.genre).filter(Boolean)])];
const allCourses = () => [...new Set([...(store.settings.courses || []), ...store.recipes.list.map((r) => r.course).filter(Boolean)])];

// ジャンル行は「すべて」で解除
function renderChips() {
  const box = H.genreChips;
  box.innerHTML = '';
  const counts = {};
  store.recipes.list.forEach((r) => { if (r.genre) counts[r.genre] = (counts[r.genre] || 0) + 1; });
  const cats = allGenres().filter((c) => counts[c]);
  if (state.genre !== 'all' && !counts[state.genre]) state.genre = 'all';
  box.hidden = !cats.length;
  const sync = () => box.querySelectorAll('.chip').forEach((c) => {
    const on = c.dataset.v === state.genre;
    c.classList.toggle('active', on);
    c.setAttribute('aria-pressed', String(on));
  });
  const add = (val, label, n) => {
    const b = el('button', 'chip', label);
    b.type = 'button';
    b.dataset.v = val;
    b.title = label;
    b.append(el('span', 'n', String(n)));
    b.onclick = () => {
      if (state.genre === val) return;
      state.genre = val;
      sync();
      b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      renderGrid();
    };
    box.append(b);
  };
  add('all', 'すべて', store.recipes.list.length);
  cats.forEach((c) => add(c, c, counts[c]));
  sync();
  // 使われなくなった種類で絞り込んだままにしない
  if (state.course !== 'all' && !store.recipes.list.some((r) => r.course === state.course)) state.course = 'all';
}

function persistFilters() {
  store.prefs.set('fav', state.fav);
  store.prefs.set('time', state.time);
  store.prefs.set('sort', state.sort);
}

// いま効いている条件は、件数の横に「外せるチップ」で出す(何で絞っているかが一目で分かる)
function renderActiveFilters() {
  const box = H.activeFilters;
  box.innerHTML = '';
  const add = (label, clear) => {
    const b = el('button', 'af-chip', label);
    b.type = 'button';
    b.insertAdjacentHTML('beforeend', ui.ICON.close);
    b.setAttribute('aria-label', `「${label}」の条件を外す`);
    b.onclick = () => { clear(); persistFilters(); renderGrid(); };
    box.append(b);
  };
  if (state.course !== 'all') add(state.course, () => { state.course = 'all'; });
  if (state.time) add(labelOf(TIME_OPTS, state.time), () => { state.time = 0; });
  if (state.fav) add('お気に入り', () => { state.fav = false; });
  if (state.sort !== 'new') add(labelOf(SORT_OPTS, state.sort), () => { state.sort = 'new'; });
  const n = box.children.length;
  H.filterN.hidden = !n;
  H.filterN.textContent = String(n);
  H.filterBtn.classList.toggle('on', n > 0);
}

/* ---------------- 絞り込みと並び替え(シート) ---------------- */
function buildFilterSheet() {
  filterOv = ui.sheet({ id: 'filter', title: '絞り込み', build(body) {
    FS.courseSec = el('section', 'sec');
    FS.courses = el('div', 'filter-chips');
    FS.courseSec.append(el('h3', 'sec-h', '種類'), FS.courses);

    const timeSec = el('section', 'sec');
    FS.times = el('div', 'segmented wide');
    FS.times.setAttribute('role', 'group');
    FS.times.setAttribute('aria-label', '調理時間');
    TIME_OPTS.forEach((o) => {
      const b = el('button', null, o.label);
      b.type = 'button';
      b.dataset.v = String(o.value);
      b.onclick = () => { state.time = o.value; applyFilters(); };
      FS.times.append(b);
    });
    timeSec.append(el('h3', 'sec-h', '調理時間'), FS.times);

    const favRow = el('label', 'switch-row');
    FS.fav = el('input');
    FS.fav.type = 'checkbox';
    FS.fav.onchange = () => { state.fav = FS.fav.checked; applyFilters(); };
    const sw = el('span', 'switch');
    sw.setAttribute('aria-hidden', 'true');
    favRow.append(el('span', null, 'お気に入りだけ'), FS.fav, sw);

    const sortSec = el('section', 'sec');
    FS.sort = el('ul', 'radio-list');
    FS.sort.setAttribute('role', 'radiogroup');
    FS.sort.setAttribute('aria-label', '並び替え');
    sortSec.append(el('h3', 'sec-h', '並び替え'), FS.sort);

    const foot = el('div', 'filter-foot');
    FS.clear = el('button', 'btn ghost', '条件をクリア');
    FS.clear.type = 'button';
    FS.clear.onclick = () => { state.course = 'all'; state.time = 0; state.fav = false; state.sort = 'new'; applyFilters(); };
    FS.show = el('button', 'btn primary');
    FS.show.type = 'button';
    FS.show.dataset.close = '';
    foot.append(FS.clear, FS.show);

    body.append(FS.courseSec, timeSec, favRow, sortSec, foot);
  } });
}

function renderFilterSheet() {
  const counts = {};
  store.recipes.list.forEach((r) => { if (r.course) counts[r.course] = (counts[r.course] || 0) + 1; });
  const courses = allCourses().filter((c) => counts[c]);
  FS.courses.innerHTML = '';
  FS.courseSec.hidden = !courses.length;
  courses.forEach((c) => {
    const on = state.course === c;
    const b = el('button', 'chip' + (on ? ' active' : ''), c);
    b.type = 'button';
    b.title = c;
    b.setAttribute('aria-pressed', String(on));
    b.append(el('span', 'n', String(counts[c])));
    b.onclick = () => { state.course = on ? 'all' : c; applyFilters(); };
    FS.courses.append(b);
  });
  FS.times.querySelectorAll('button').forEach((b) => {
    const on = +b.dataset.v === state.time;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  FS.fav.checked = state.fav;
  FS.sort.innerHTML = '';
  SORT_OPTS.forEach((o) => {
    const on = state.sort === o.value;
    const li = el('li');
    const b = el('button', 'radio-item' + (on ? ' selected' : ''));
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    const mark = el('span', 'ri-mark');
    mark.innerHTML = ui.ICON.check;
    b.append(el('span', null, o.label), mark);
    b.onclick = () => { state.sort = o.value; applyFilters(); };
    li.append(b);
    FS.sort.append(li);
  });
  FS.show.textContent = `${store.recipes.list.filter((r) => matches(r, state)).length}件を表示`;
  FS.clear.disabled = !(state.course !== 'all' || state.time || state.fav || state.sort !== 'new');
}

function applyFilters() {
  persistFilters();
  renderGrid();
  renderFilterSheet();
}

/* ---------------- 予測変換 ---------------- */
function renderSuggest() {
  const items = suggestions(H.q.value, store.recipes.list);
  H.suggest.innerHTML = '';
  state.sugIndex = -1;
  items.forEach((item, i) => {
    const li = el('li');
    li.setAttribute('role', 'option');
    li.style.setProperty('--i', i);
    const thumb = el('span', 'thumb');
    if (item.tag) {
      thumb.textContent = '#';
      li.append(thumb, el('span', 's-name', item.tag), el('span', 's-cat', `${item.n}件`));
      li._pick = () => { closeSuggest(); H.q.blur(); setQuery('#' + item.tag); };
    } else {
      const r = item.r;
      const img = heroImage(r);
      if (img) thumb.append(img); else thumb.textContent = '🍽';
      const name = el('span', 's-name');
      name.append(highlight(r.name, H.q.value));
      li.append(thumb, name, el('span', 's-cat', r.genre || ''));
      li._pick = () => { closeSuggest(); H.q.blur(); openDetail(r.id, { origin: li }); };
    }
    li.addEventListener('mousedown', (e) => { e.preventDefault(); li._pick(); });
    H.suggest.append(li);
  });
  const open = items.length > 0 && document.activeElement === H.q;
  H.suggest.classList.toggle('open', open);
  H.q.setAttribute('aria-expanded', String(open));
}

function closeSuggest() {
  H.suggest.classList.remove('open');
  H.q.setAttribute('aria-expanded', 'false');
  state.sugIndex = -1;
}

function moveSug(d) {
  const lis = [...H.suggest.children];
  if (!lis.length) return;
  state.sugIndex = (state.sugIndex + d + lis.length) % lis.length;
  lis.forEach((li, i) => li.classList.toggle('active', i === state.sugIndex));
  lis[state.sugIndex].scrollIntoView({ block: 'nearest' });
}

function bindSearch() {
  let searchRaf;
  H.q.addEventListener('input', () => {
    state.query = H.q.value;
    H.search.classList.toggle('has-text', !!H.q.value);
    renderSuggest();
    cancelAnimationFrame(searchRaf);
    searchRaf = requestAnimationFrame(renderGrid);
  });
  H.q.addEventListener('focus', () => { H.search.classList.add('focus'); renderSuggest(); });
  H.q.addEventListener('blur', () => { H.search.classList.remove('focus'); closeSuggest(); });
  H.q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSug(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSug(-1); }
    else if (e.key === 'Enter') {
      if (e.isComposing) return; // 日本語変換中の Enter は無視
      e.preventDefault();
      const li = H.suggest.children[state.sugIndex];
      if (li) li._pick();
      else { closeSuggest(); H.q.blur(); }
    } else if (e.key === 'Escape') {
      if (H.suggest.classList.contains('open')) closeSuggest(); else H.q.blur();
    }
  });
  H.clear.addEventListener('click', () => {
    H.q.value = '';
    H.q.dispatchEvent(new Event('input'));
    H.q.focus();
  });
}

/* ---------------- カードの操作 ---------------- */
async function toggleFav(r) {
  r.favorite = !r.favorite;
  await store.recipes.put(r); // 'recipes' イベントでカードが差し替わる
}

function bindGrid() {
  H.grid.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const favBtn = e.target.closest('.fav');
    if (favBtn) {
      const r = store.recipes.get(card.dataset.id);
      if (!r) return;
      favBtn.classList.toggle('on', !r.favorite);
      favBtn.setAttribute('aria-pressed', String(!r.favorite));
      replay(favBtn, 'pop');
      // カードの差し替えはアニメーションの後で
      setTimeout(() => toggleFav(r), 380);
      return;
    }
    openDetail(card.dataset.id, { origin: card });
  });
  H.grid.addEventListener('keydown', (e) => {
    const card = e.target.closest('.card');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(card.dataset.id, { origin: card }); }
  });
}

/* ---------------- データの変化 ---------------- */
function onRecipes({ changed, removed }) {
  // 無くなったレシピ(ゴミ箱へ・削除・ボックスの切り替え)のカードを外す
  // 見えているカードが数枚消えるときは、小さくなって消えてから残りを並び直す(ボックスの切り替えなど大量のときは即時)
  const gone = [];
  cardNodes.forEach((node, id) => {
    if (store.recipes.get(id)) return;
    cardNodes.delete(id);
    if (node.isConnected && !node.hidden && removed.length <= 3) gone.push(node); else node.remove();
  });
  changed.forEach(refreshCard);
  renderChips();
  if (!gone.length) { renderGrid(); return; }
  let left = gone.length;
  gone.forEach((node) => {
    node.style.pointerEvents = 'none';
    node.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.85)' }], { duration: 320, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
      .onfinish = () => { node.remove(); if (!--left) renderGrid(); };
  });
}

export function init() {
  state.fav = !!store.prefs.get('fav', false);
  state.time = +store.prefs.get('time', 0) || 0;
  state.sort = SORTS[store.prefs.get('sort', 'new')] ? store.prefs.get('sort', 'new') : 'new';
  buildHome();
  buildFilterSheet();
  bindSearch();
  bindGrid();
  store.on('recipes', onRecipes);
  store.on('settings', () => { renderChips(); renderGrid(); });
  store.on('loaded', () => { renderChips(); renderGrid(); });
  renderChips();
  renderGrid();
}
