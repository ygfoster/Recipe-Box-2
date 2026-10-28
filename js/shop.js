// 買い物タブ(#view-shop):グループ、チェック、左スワイプ削除、手動追加、すべて削除+元に戻す、片づける、共有テキスト
// v1 の plan.js の買い物リスト部分から移植。献立からの合算(buildShopping)は plan.js の「買い物リストを作る」が行う
import { store, normalizeShopItem } from './store.js';
import * as ui from './ui.js';
import { el, uid } from './lib/text.js';
import { parseIngredient, ingKey, stripNote } from './lib/ingredients.js';

const GROUPS = [
  { id: 'food', label: '食材', note: '' },
  { id: 'season', label: '調味料・常備品', note: '家にあれば買わなくてOK' },
  { id: 'manual', label: '自分で追加したもの', note: '' },
];
const byTime = (a, b) => a.createdAt - b.createdAt;
const SWIPE_OPEN = 88; // ゴミ箱ボタンの幅(px)

let subEl, listBox, emptyBox, shareBtn, addInput;
let doneOpen = false; // 「買ったもの」を開いているか(描き直しても保つ)
let fresh = true; // 読み込み後の最初の描画は、行を順にふわっと出す
let swipeOpen = null; // ゴミ箱が出ている行

export function init() {
  const view = document.getElementById('view-shop');
  view.innerHTML = `
    <div class="shop-head"><h1>買い物リスト</h1><p class="shop-sub"></p></div>
    <div class="shop-tools">
      <form class="add-row shop-add" novalidate>
        <input maxlength="40" autocomplete="off" enterkeyhint="done" placeholder="買うものを追加(例:牛乳 1本)" aria-label="買うものを追加">
        <button class="btn small" type="submit">追加</button>
      </form>
      <button class="round-btn shop-share" type="button" aria-label="買い物リストを共有">${ui.ICON.share}</button>
    </div>
    <div class="shop-list"></div>
    <section class="empty shop-empty" hidden>
      <div class="empty-icon">🛒</div>
      <h2>買い物リストは空です</h2>
      <p>献立から作るか、上の欄から追加してください。</p>
      <button class="btn primary" type="button" data-goto="plan">献立を開く</button>
    </section>`;
  subEl = view.querySelector('.shop-sub');
  listBox = view.querySelector('.shop-list');
  emptyBox = view.querySelector('.shop-empty');
  shareBtn = view.querySelector('.shop-share');
  addInput = view.querySelector('.shop-add input');
  view.querySelector('.shop-add').addEventListener('submit', onAdd);
  shareBtn.addEventListener('click', share);

  store.on('shop', () => { if (ui.getTab() === 'shop') render(fresh); });
  store.on('box', () => { fresh = true; });
  ui.onTab((tab) => { if (tab === 'shop') render(true); });
  // ほかの場所を触ったら、開いているゴミ箱を閉じる
  document.addEventListener('pointerdown', (e) => {
    if (swipeOpen && !swipeOpen.contains(e.target)) closeSwipe(swipeOpen);
  });
}

/* ---------------- ほかの画面から入れる(食材から探す など) ---------------- */
// items = [{ key, name, amount, recipes?, group:'food'|'season'|'manual' }]。未購入の同じ key は入れない
// 戻り値 { added, skipped }。入れた数と重複の数は toast で知らせる
export async function addToShop(items) {
  const list = Array.isArray(items) ? items : [];
  const now = Date.now();
  const seen = new Set();
  const ops = [];
  let skipped = 0;
  list.forEach((it, i) => {
    const key = String(it.key || ingKey(it.name || ''));
    if (!key) return;
    if (seen.has(key) || store.shop.list.some((s) => !s.checked && s.key === key)) { skipped++; return; }
    seen.add(key);
    const group = ['food', 'season', 'manual'].includes(it.group) ? it.group : it.season === true ? 'season' : it.season === false ? 'food' : 'manual';
    ops.push({
      type: 'put',
      d: normalizeShopItem({ id: uid(), key, name: it.name, amount: it.amount, recipes: it.recipes, group, source: 'manual', checked: false, createdAt: now + i }),
    });
  });
  if (!ops.length && !skipped) return { added: 0, skipped: 0 }; // 入れるものが無い(名前の無い項目だけなど)ときは何も言わない
  if (ops.length && !(await store.shop.batch(ops))) return { added: 0, skipped };
  ui.toast(ops.length
    ? `${ops.length}点を買い物リストに入れました${skipped ? `(${skipped}点はすでにリストにあります)` : ''}`
    : 'すべてすでに買い物リストにあります');
  return { added: ops.length, skipped };
}

/* ---------------- 描画 ---------------- */
function render(animate) {
  const all = store.shop.list;
  // 読み込み前(起動直後・ボックス切り替え直後)は「空です」と見せない
  if (!store.loaded) {
    listBox.innerHTML = '';
    subEl.textContent = '';
    emptyBox.hidden = true;
    shareBtn.disabled = true;
    return;
  }
  if (animate) fresh = false;
  const todo = all.filter((s) => !s.checked);
  const done = all.filter((s) => s.checked);
  subEl.textContent = all.length
    ? (todo.length ? `残り ${todo.length}点${done.length ? ` · 買ったもの ${done.length}点` : ''}` : 'すべて買いました 🎉')
    : '';

  // 描き直す前の位置を覚えておき、並びが変わった行は今の位置から滑らかに移動させる
  const before = new Map();
  if (!animate) listBox.querySelectorAll('.shop-item').forEach((li) => before.set(li.dataset.id, li.getBoundingClientRect().top));
  swipeOpen = null;
  listBox.innerHTML = '';
  listBox.classList.toggle('animate', !!animate);

  GROUPS.forEach((g) => {
    const list = todo.filter((s) => s.group === g.id).sort(byTime);
    if (!list.length) return;
    const sec = el('section', 'shop-group');
    const h = el('h3', 'shop-h', g.label);
    if (g.note) h.append(el('span', null, g.note));
    const ul = el('ul', 'shop-ul');
    list.forEach((s, i) => ul.append(shopRow(s, i)));
    sec.append(h, ul);
    listBox.append(sec);
  });

  if (done.length) {
    const det = el('details', 'shop-done');
    det.open = doneOpen;
    const sum = el('summary', null, `買ったもの ${done.length}点`);
    // 開閉で高さが変わるぶんは、下にある要素を移動で追従させる
    sum.addEventListener('click', (ev) => {
      ev.preventDefault();
      const below = [];
      for (let n = det.nextElementSibling; n; n = n.nextElementSibling) below.push(n);
      ui.shift(below, () => { det.open = !det.open; doneOpen = det.open; });
    });
    const ul = el('ul', 'shop-ul');
    done.sort(byTime).forEach((s, i) => ul.append(shopRow(s, i)));
    const clear = el('button', 'btn small ghost', '買ったものを片づける');
    clear.type = 'button';
    clear.onclick = async () => {
      if (await store.shop.batch(done.map((s) => ({ type: 'del', id: s.id })))) ui.toast(`${done.length}点を片づけました`);
    };
    det.append(sum, ul, clear);
    listBox.append(det);
  }

  // リストをすべて削除(2段階。消したあとも少しの間は元に戻せる)
  if (all.length) {
    const btn = el('button', 'btn ghost danger wide shop-clear-all', 'リストをすべて削除');
    btn.type = 'button';
    btn.onclick = async () => {
      if (!btn.classList.contains('confirm')) {
        btn.classList.add('confirm');
        btn.textContent = `${all.length}点をすべて削除する`;
        setTimeout(() => { if (btn.isConnected) { btn.classList.remove('confirm'); btn.textContent = 'リストをすべて削除'; } }, 3000);
        return;
      }
      const saved = store.shop.list.map((x) => ({ ...x }));
      if (!(await store.shop.batch(saved.map((x) => ({ type: 'del', id: x.id }))))) return;
      ui.toast('買い物リストを空にしました', {
        label: '元に戻す',
        run: () => store.shop.batch(saved.map((d) => ({ type: 'put', d }))),
      });
    };
    listBox.append(btn);
  }

  emptyBox.hidden = all.length > 0;
  shareBtn.disabled = !todo.length;

  if (!animate && before.size) {
    listBox.querySelectorAll('.shop-item').forEach((li) => {
      const top = before.get(li.dataset.id);
      if (top == null) {
        li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
        return;
      }
      const dy = top - li.getBoundingClientRect().top;
      if (dy) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.32,.72,0,1)' });
    });
  }
}

function shopRow(s, i) {
  const li = el('li', 'shop-item' + (s.checked ? ' done' : ''));
  li.style.setProperty('--i', Math.min(i, 12));
  li.dataset.id = s.id;

  // 左にスワイプすると出てくる削除ボタン
  const actions = el('div', 'si-actions');
  const trash = el('button', 'si-trash');
  trash.type = 'button';
  trash.innerHTML = ui.ICON.trash;
  trash.append(el('span', null, '削除'));
  trash.setAttribute('aria-label', `「${s.name}」を削除`);
  trash.tabIndex = -1;
  trash.onclick = () => removeShopItem(s, li);
  actions.append(trash);

  const front = el('div', 'si-front');
  const btn = el('button', 'si-main');
  btn.type = 'button';
  btn.setAttribute('role', 'checkbox');
  btn.setAttribute('aria-checked', String(s.checked));
  const check = el('span', 'si-check');
  check.innerHTML = ui.ICON.check;
  const text = el('span', 'si-text');
  text.append(el('span', 'si-name', s.name));
  if (s.recipes.length) text.append(el('span', 'si-sub', s.recipes.join('・')));
  btn.append(check, text);
  if (s.amount) btn.append(el('span', 'si-amt', s.amount));
  btn.onclick = () => {
    if (li._swiped) return; // スワイプした直後の指離れはチェックにしない
    if (li.classList.contains('open')) return closeSwipe(li);
    li.classList.add(s.checked ? 'unchecking' : 'checking');
    setTimeout(() => store.shop.put({ ...s, checked: !s.checked }), 320);
  };
  front.append(btn);

  // マウスのとき(Mac)は、行にカーソルを乗せるとゴミ箱が出る
  const del = el('button', 'si-del');
  del.type = 'button';
  del.innerHTML = ui.ICON.trash;
  del.setAttribute('aria-label', `「${s.name}」を削除`);
  del.onclick = () => removeShopItem(s, li);
  front.append(del);

  li.append(actions, front);
  attachSwipe(li, front, s);
  return li;
}

/* ---------------- スワイプで削除 ---------------- */
function setSwipeX(li, x, animate) {
  const front = li.querySelector('.si-front');
  front.style.transition = animate ? '' : 'none';
  front.style.transform = x ? `translateX(${x}px)` : '';
  li.style.setProperty('--reveal', String(Math.min(1, Math.max(0, -x / SWIPE_OPEN))));
}

function openSwipe(li) {
  if (swipeOpen && swipeOpen !== li) closeSwipe(swipeOpen);
  li.classList.add('open');
  li.querySelector('.si-trash').tabIndex = 0;
  setSwipeX(li, -SWIPE_OPEN, true);
  swipeOpen = li;
}

function closeSwipe(li) {
  if (!li) return;
  li.classList.remove('open', 'full');
  li.querySelector('.si-trash').tabIndex = -1;
  setSwipeX(li, 0, true);
  if (swipeOpen === li) swipeOpen = null;
}

function attachSwipe(li, front, s) {
  front.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('.si-del')) return;
    const sx = e.clientX, sy = e.clientY;
    const base = li.classList.contains('open') ? -SWIPE_OPEN : 0;
    const width = li.offsetWidth;
    let mode = null; // 'h' = 横スワイプ、'v' = 縦スクロール
    let x = base;

    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!mode) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          mode = 'h';
          front.setPointerCapture(ev.pointerId);
          if (swipeOpen && swipeOpen !== li) closeSwipe(swipeOpen);
        } else if (Math.abs(dy) > 8) {
          mode = 'v';
          return stop();
        } else return;
      }
      x = base + dx;
      if (x > 0) x *= 0.2; // 右へはほとんど動かない
      setSwipeX(li, x, false);
      // 大きく引っぱったら「離すと削除」の見た目にする
      li.classList.toggle('full', x < -width * 0.55);
    };
    const up = () => {
      stop();
      if (mode !== 'h') return;
      li._swiped = true;
      setTimeout(() => { li._swiped = false; }, 0);
      if (x < -width * 0.55) removeShopItem(s, li);
      else if (x < -40) openSwipe(li);
      else closeSwipe(li);
    };
    const stop = () => {
      front.removeEventListener('pointermove', move);
      front.removeEventListener('pointerup', up);
      front.removeEventListener('pointercancel', up);
    };
    front.addEventListener('pointermove', move);
    front.addEventListener('pointerup', up);
    front.addEventListener('pointercancel', up);
  });
}

// 行を左へ送り出してから消し、下の行は移動で詰める(高さのアニメーションは使わない)
function removeShopItem(s, li) {
  if (swipeOpen === li) swipeOpen = null;
  li.classList.add('removing');
  setSwipeX(li, -li.offsetWidth, true);
  setTimeout(async () => {
    if (await store.shop.del(s.id)) ui.toast(`「${s.name}」を削除しました`);
  }, 260);
}

/* ---------------- 手動で追加 ---------------- */
async function onAdd(e) {
  e.preventDefault();
  const raw = addInput.value.trim();
  if (!raw) return addInput.focus();
  const p = parseIngredient(raw);
  const key = ingKey(p.name);
  // 同じものがまだ買っていない状態であれば、二重に追加しない
  const same = store.shop.list.find((s) => !s.checked && s.key === key);
  if (same) {
    ui.toast(`「${same.name}」はすでにリストにあります`);
    return addInput.select();
  }
  const d = normalizeShopItem({ id: uid(), key, name: stripNote(p.name) || raw, amount: p.amount, group: 'manual', source: 'manual', createdAt: Date.now() });
  addInput.value = '';
  await store.shop.put(d);
}

/* ---------------- 共有(テキスト) ---------------- */
function shopText() {
  const todo = store.shop.list.filter((s) => !s.checked);
  const out = ['買い物リスト'];
  GROUPS.forEach((g) => {
    const list = todo.filter((s) => s.group === g.id).sort(byTime);
    if (!list.length) return;
    out.push('', `■ ${g.label}${g.note ? `(${g.note})` : ''}`);
    list.forEach((s) => out.push(`・${s.name}${s.amount ? ' ' + s.amount : ''}`));
  });
  return out.join('\n');
}

async function share() {
  const text = shopText();
  if (navigator.share) {
    try {
      await navigator.share({ title: '買い物リスト', text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    ui.toast('買い物リストをコピーしました。Google Keep や LINE に貼り付けて送れます');
  } catch {
    ui.toast('共有できませんでした');
  }
}
