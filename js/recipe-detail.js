// レシピの詳細:全画面ページ(写真 → ピル → 料理名+共有 → ★ → 材料(人数換算)→ 作り方 → タグ → メモ → 作った記録 → 編集/削除)
// 下に固定のアクションバー(♥・献立に追加・調理モード)。v1 の app.js(Detail / 作った記録 / 削除)から移植
import { store } from './store.js';
import * as ui from './ui.js';
import { el, lines, uid, todayStr, fmtDate, daysAgo, fmtClock, linkify, replay } from './lib/text.js';
import { ingredientRows, parseStep, findDurations } from './lib/ingredients.js';
import { videoInfo } from './lib/video.js';
import { heroImage, makeImg, compressImage } from './lib/image.js';
import { lastCooked } from './lib/search.js';
import { openPip } from './pip.js';
import { startTimer } from './timers.js';
import { openCook } from './cook.js';
import { openForm } from './recipe-form.js';
import { openSlotPicker } from './plan.js';
import { setQuery } from './recipes.js';

let ov;
const D = {}; // 画面の部品
let detailId = null;
let servings = 2; // いま表示している人数
let logPhoto = null;
let delTimer;
let selfWrite = false; // 自分の保存で飛ぶ 'recipes' イベントでは描き直さない

/* ---------------- 手順のチップ(動画の頭出し・タイマー)。調理モードでも使う ---------------- */
export function stepChips(r, step, inCook) {
  const wrap = el('div', 'step-chips');
  const v = videoInfo(r.videoUrl);
  if (step.t != null && v && v.type === 'youtube') {
    const b = ui.iconBtn('chip-btn ts', 'play', fmtClock(step.t));
    b.setAttribute('aria-label', `動画の${fmtClock(step.t)}から再生`);
    b.onclick = (e) => { e.stopPropagation(); openPip(r, step.t, b); };
    wrap.append(b);
  }
  findDurations(step.text).forEach((d) => {
    const b = ui.iconBtn('chip-btn tm', 'timer', d.label);
    b.setAttribute('aria-label', `${d.label}のタイマーを開始`);
    b.onclick = (e) => { e.stopPropagation(); startTimer(d.sec, `${r.name} · ${d.label}`); };
    wrap.append(b);
  });
  if (inCook) return wrap;
  return wrap.children.length ? wrap : null;
}

/* ---------------- 骨組み(作成時に1回) ---------------- */
function build(body, o) {
  // 左上の ‹。写真の上に浮かせ、スクロールしても上に残る(高さ0の sticky)
  // 写真が画面から消えたら、料理名の帯(d-topbar)を出して ‹ をその中に収める(中身に重ならない)
  const top = el('div', 'd-top');
  const topbar = el('div', 'd-topbar');
  D.topTitle = el('span', 'd-top-title');
  topbar.append(D.topTitle);
  const back = el('button', 'd-back');
  back.type = 'button';
  back.dataset.close = '';
  back.setAttribute('aria-label', '閉じる');
  back.innerHTML = ui.ICON.back;
  top.append(topbar, back);
  D.top = top;

  D.hero = el('div', 'd-hero');
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      top.classList.toggle('solid', ui.isOpen(o) && !e.isIntersecting);
    }, { root: o, rootMargin: '-52px 0px 0px 0px', threshold: 0 }).observe(D.hero);
  }
  const main = el('div', 'd-main');
  D.pills = el('div', 'd-pills');
  const titlebar = el('div', 'd-titlebar');
  D.title = el('h2', 'd-title');
  D.title.id = 'dTitle';
  D.share = ui.iconBtn('round-btn', 'share');
  D.share.setAttribute('aria-label', 'このレシピを共有');
  titlebar.append(D.title, D.share);
  D.stars = el('div', 'stars');
  D.stars.setAttribute('aria-label', '評価');
  for (let i = 1; i <= 5; i++) {
    const b = ui.iconBtn('', 'star');
    b.dataset.v = i;
    b.style.setProperty('--i', i - 1);
    b.setAttribute('aria-label', `${i}つ星`);
    D.stars.append(b);
  }

  // 材料(人数のステッパーで換算)
  D.ingBlock = el('section', 'd-block');
  const ingHead = el('div', 'd-head');
  D.stepper = el('div', 'stepper');
  const minus = el('button', null, '−');
  minus.type = 'button';
  minus.dataset.d = '-1';
  minus.setAttribute('aria-label', '減らす');
  D.servVal = el('span');
  const plus = el('button', null, '＋');
  plus.type = 'button';
  plus.dataset.d = '1';
  plus.setAttribute('aria-label', '増やす');
  D.stepper.append(minus, D.servVal, plus);
  ingHead.append(el('h3', 'sec-h', '材料'), D.stepper);
  D.scaleNote = el('p', 'scale-note');
  D.scaleNote.hidden = true;
  D.ing = el('ul', 'ing');
  D.ingBlock.append(ingHead, D.scaleNote, D.ing);

  // 作り方・タグ・メモ
  D.stepsBlock = el('section', 'd-block');
  D.steps = el('ol', 'steps');
  D.stepsBlock.append(el('h3', 'sec-h', '作り方'), D.steps);
  D.tags = el('div', 'd-tags');
  D.memoBlock = el('section', 'd-block');
  D.memo = el('div', 'memo');
  D.memoBlock.append(el('h3', 'sec-h', 'メモ'), D.memo);

  // 作った記録(回数・最後の日付・「作った！」フォーム・一覧)
  const logBlock = el('section', 'd-block log');
  const logHead = el('div', 'd-head');
  D.cookedBtn = el('button', 'btn small primary', '＋ 作った！');
  D.cookedBtn.type = 'button';
  logHead.append(el('h3', 'sec-h', '作った記録'), D.cookedBtn);
  D.logSum = el('p', 'log-sum');
  D.logForm = el('form', 'log-form');
  D.logForm.noValidate = true;
  const inner = el('div', 'log-form-inner');
  const row = el('div', 'log-row');
  D.logDate = el('input');
  D.logDate.type = 'date';
  D.logDate.setAttribute('aria-label', '作った日');
  D.logPhotoBtn = el('label', 'log-photo');
  D.logPhoto = el('input');
  D.logPhoto.type = 'file';
  D.logPhoto.accept = 'image/*';
  D.logPhoto.hidden = true;
  D.logPhotoLabel = el('span', null, '📷 写真');
  D.logPhotoBtn.append(D.logPhoto, D.logPhotoLabel);
  row.append(D.logDate, D.logPhotoBtn);
  D.logNote = el('input', 'log-note');
  D.logNote.maxLength = 200;
  D.logNote.placeholder = 'ひとこと(味の感想、次はこうしたい など)';
  D.logNote.autocomplete = 'off';
  const acts = el('div', 'log-form-actions');
  D.logCancel = el('button', 'btn small ghost', 'やめる');
  D.logCancel.type = 'button';
  const logSubmit = el('button', 'btn small primary', '記録する');
  logSubmit.type = 'submit';
  acts.append(D.logCancel, logSubmit);
  inner.append(row, D.logNote, acts);
  D.logForm.append(inner);
  D.logList = el('ul', 'log-list');
  logBlock.append(logHead, D.logSum, D.logForm, D.logList);

  // 編集(鉛筆・操作色)/ 削除(ゴミ箱・危険色。1回目で「本当に削除する」に広がる)
  D.manage = el('div', 'manage');
  D.delBtn = el('button', 'manage-btn delete');
  D.delBtn.type = 'button';
  D.delBtn.setAttribute('aria-label', '削除');
  D.delBtn.innerHTML = '<span class="mb-bg" aria-hidden="true"></span><span class="mb-label" aria-hidden="true">本当に削除する</span>' + ui.ICON.trash;
  D.editBtn = el('button', 'manage-btn edit');
  D.editBtn.type = 'button';
  D.editBtn.setAttribute('aria-label', '編集');
  D.editBtn.innerHTML = ui.ICON.edit;
  D.manage.append(D.delBtn, D.editBtn);

  main.append(D.pills, titlebar, D.stars, D.ingBlock, D.stepsBlock, D.tags, D.memoBlock, logBlock, D.manage);

  // 下に固定のアクションバー:どこまで読んでも親指で押せる
  D.bar = el('div', 'd-bar');
  D.fav = ui.iconBtn('fav big', 'heart');
  D.fav.setAttribute('aria-label', 'お気に入り');
  D.planBtn = ui.iconBtn('btn', 'calendar', '献立に追加');
  D.cookBtn = ui.iconBtn('btn primary', 'chef', '調理モード');
  D.bar.append(D.fav, D.planBtn, D.cookBtn);

  body.append(top, D.hero, main, D.bar);
  o.panel.setAttribute('aria-labelledby', 'dTitle');
}

/* ---------------- 描画 ---------------- */
function renderHero(r) {
  D.hero.innerHTML = '';
  const img = heroImage(r);
  if (img) D.hero.append(img); else D.hero.append(el('span', 'd-hero-glyph', '🍽'));
  const v = videoInfo(r.videoUrl);
  const playable = !!(v && v.type === 'youtube');
  D.hero.classList.toggle('playable', playable);
  D.hero.onclick = null;
  if (playable) {
    // 写真を隠さないよう、再生ボタンは左下に小さく。写真のどこを押しても再生できる
    const play = ui.iconBtn('hero-play', 'play', '再生');
    play.setAttribute('aria-label', '動画を再生');
    D.hero.append(play);
    D.hero.onclick = () => openPip(r, v.start, play);
  } else if (v) {
    // YouTube 以外(Instagram / TikTok / X)はアプリ内で再生できないので、元のアプリで開く
    const a = el('a', 'hero-play');
    a.href = v.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.innerHTML = ui.ICON.link;
    a.append(`${v.label}で開く`);
    D.hero.append(a);
  }
}

function renderPills(r) {
  D.pills.innerHTML = '';
  if (r.genre) D.pills.append(el('span', 'pill', r.genre));
  if (r.course) D.pills.append(el('span', 'pill', r.course));
  if (r.time) {
    const p = el('span', 'pill');
    p.innerHTML = ui.ICON.timer;
    p.append(`${r.time}分`);
    D.pills.append(p);
  }
  D.pills.hidden = !D.pills.children.length;
}

function renderFav(r) {
  D.fav.classList.toggle('on', r.favorite);
  D.fav.setAttribute('aria-pressed', String(r.favorite));
}

function renderStars(r, animate) {
  [...D.stars.children].forEach((b, i) => {
    b.classList.toggle('on', i < r.rating);
    if (animate && i < r.rating) replay(b, 'pop');
  });
}

function renderIngredients(r, bump) {
  const k = servings / r.servings;
  const rows = ingredientRows(r, k);
  D.ingBlock.hidden = !rows.length;
  D.ing.innerHTML = '';
  rows.forEach((row) => {
    const li = el('li', row.header ? 'i-head' : null);
    if (row.header) li.textContent = row.name;
    else {
      const amt = el('span', 'i-amt' + (row.changed ? ' scaled' : ''), row.scaled);
      if (bump && row.amount) amt.classList.add('bump');
      li.append(el('span', 'i-name', row.name), amt);
    }
    D.ing.append(li);
  });
  D.scaleNote.hidden = k === 1;
  D.scaleNote.textContent = `${r.servings}人分のレシピから換算しています`;
  D.servVal.textContent = `${servings}人分`;
  D.stepper.querySelector('[data-d="-1"]').disabled = servings <= 1;
  D.stepper.querySelector('[data-d="1"]').disabled = servings >= 20;
}

function renderSteps(r) {
  const steps = lines(r.steps).map(parseStep);
  D.stepsBlock.hidden = !steps.length;
  D.steps.innerHTML = '';
  steps.forEach((s) => {
    const li = el('li');
    li.append(linkify(s.text));
    const chips = stepChips(r, s);
    if (chips) li.append(chips);
    D.steps.append(li);
  });
}

function renderTags(r) {
  D.tags.innerHTML = '';
  r.tags.forEach((t) => {
    const b = el('button', 'tag', '#' + t);
    b.type = 'button';
    b.onclick = () => {
      ui.close(ov);
      setQuery('#' + t);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    D.tags.append(b);
  });
  D.tags.hidden = !r.tags.length;
}

function renderMemo(r) {
  D.memo.innerHTML = '';
  const text = (r.memo || '').trim();
  D.memoBlock.hidden = !text;
  if (text) D.memo.append(linkify(text));
}

function renderLog(r) {
  const n = r.cooked.length;
  if (n) {
    const last = lastCooked(r);
    D.logSum.textContent = `${n}回作りました · 最後は${fmtDate(last)}(${daysAgo(last)})`;
  } else {
    D.logSum.textContent = 'まだ記録がありません。作ったら「作った！」を押しましょう。';
  }
  D.logList.innerHTML = '';
  [...r.cooked].sort((a, b) => b.date.localeCompare(a.date)).forEach((c) => {
    const li = el('li');
    li.append(el('span', 'l-date', fmtDate(c.date)), el('span', 'l-note', c.note || ''));
    if (c.photo) li.append(makeImg(c.photo));
    const del = el('button', 'l-del');
    del.type = 'button';
    del.innerHTML = ui.ICON.close;
    del.setAttribute('aria-label', 'この記録を消す');
    del.onclick = async () => {
      r.cooked = r.cooked.filter((x) => x.id !== c.id);
      li.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(20px)' }], { duration: 250, fill: 'forwards' })
        .onfinish = () => renderLog(r);
      await save(r);
    };
    li.append(del);
    D.logList.append(li);
  });
}

function render(r) {
  renderHero(r);
  renderPills(r);
  D.title.textContent = r.name;
  D.topTitle.textContent = r.name;
  renderFav(r);
  renderStars(r);
  renderIngredients(r);
  renderSteps(r);
  renderTags(r);
  renderMemo(r);
  renderLog(r);
}

/* ---------------- 保存(自分の変更で画面を描き直さない) ---------------- */
async function save(r) {
  selfWrite = true;
  try { return await store.recipes.put(r); } finally { selfWrite = false; }
}

/* ---------------- 共有(受け取る人はアプリを持っていないので、そのまま読めるテキストで) ---------------- */
function recipeText(r) {
  const k = servings / r.servings;
  const out = [r.name];
  const meta = [r.genre, r.course, r.time ? `${r.time}分` : ''].filter(Boolean).join(' · ');
  if (meta) out.push(meta);
  const ing = ingredientRows(r, k);
  if (ing.length) {
    out.push('', `【材料】${servings}人分`);
    ing.forEach((x) => out.push(x.header ? `■ ${x.name}` : `・${x.name}${x.scaled ? ' ' + x.scaled : ''}`));
  }
  const steps = lines(r.steps).map(parseStep);
  if (steps.length) {
    out.push('', '【作り方】');
    steps.forEach((s, i) => out.push(`${i + 1}. ${s.text}`));
  }
  if (r.videoUrl) out.push('', `【動画】${r.videoUrl}`);
  if (r.memo && r.memo.trim()) out.push('', '【メモ】', r.memo.trim());
  return out.join('\n');
}

async function shareRecipe(r) {
  const text = recipeText(r);
  if (navigator.share) {
    try {
      await navigator.share({ title: r.name, text });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 共有シートを閉じただけ
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    ui.toast('レシピをコピーしました。LINE などに貼り付けて送れます');
  } catch {
    ui.toast('共有できませんでした');
  }
}

/* ---------------- 作った記録のフォーム(開け閉めは下の要素を移動で追従) ---------------- */
function openLogForm() {
  D.logDate.value = todayStr();
  D.logNote.value = '';
  logPhoto = null;
  D.logPhotoBtn.classList.remove('has');
  D.logPhotoLabel.textContent = '📷 写真';
  ui.shift([D.logList, D.manage], () => D.logForm.classList.add('open'));
  setTimeout(() => D.logNote.focus({ preventScroll: true }), 300);
}
function closeLogForm(instant) {
  if (!D.logForm.classList.contains('open')) return;
  if (instant) { D.logForm.classList.remove('open'); return; }
  D.logForm.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-out' })
    .onfinish = () => ui.shift([D.logList, D.manage], () => D.logForm.classList.remove('open'));
}

/* ---------------- 削除(2段階。3秒で戻る) ---------------- */
function resetDelete() {
  clearTimeout(delTimer);
  D.delBtn.classList.remove('confirm');
  D.delBtn.setAttribute('aria-label', '削除');
}

const current = () => (detailId ? store.recipes.get(detailId) : null);

export function init() {
  ov = ui.page({ id: 'detail', head: false, build, onClose: () => { resetDelete(); closeLogForm(true); } });

  D.fav.addEventListener('click', async () => {
    const r = current();
    if (!r) return;
    r.favorite = !r.favorite;
    renderFav(r);
    replay(D.fav, 'pop');
    await save(r);
  });

  D.stars.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    const r = current();
    if (!b || !r) return;
    const v = +b.dataset.v;
    r.rating = r.rating === v ? 0 : v;
    renderStars(r, true);
    await save(r);
  });

  D.stepper.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    const r = current();
    if (!b || !r) return;
    servings = Math.max(1, Math.min(20, servings + +b.dataset.d));
    renderIngredients(r, true);
  });

  D.share.addEventListener('click', () => { const r = current(); if (r) shareRecipe(r); });
  D.planBtn.addEventListener('click', () => { if (detailId) openSlotPicker(detailId, servings, D.planBtn); });
  D.cookBtn.addEventListener('click', () => { if (detailId) openCook(detailId, servings); });
  D.editBtn.addEventListener('click', () => { if (detailId) openForm(detailId); });

  D.cookedBtn.addEventListener('click', () => {
    if (D.logForm.classList.contains('open')) closeLogForm(); else openLogForm();
  });
  D.logCancel.addEventListener('click', () => closeLogForm());
  D.logPhoto.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      logPhoto = await compressImage(f, 900, 0.8, 150000);
      D.logPhotoBtn.classList.add('has');
      D.logPhotoLabel.textContent = '📷 追加済み';
    } catch { ui.toast('この画像は読み込めませんでした'); }
  });
  D.logForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = current();
    if (!r) return;
    const entry = { id: uid(), date: D.logDate.value || todayStr(), note: D.logNote.value.trim(), photo: logPhoto };
    r.cooked.push(entry);
    if (!(await save(r))) {
      r.cooked = r.cooked.filter((c) => c !== entry);
      return;
    }
    closeLogForm();
    renderLog(r);
    replay(D.cookedBtn, 'pop');
    ui.toast(r.cooked.length === 1 ? '初めての記録です 🎉' : `${r.cooked.length}回目の記録です 🎉`);
  });

  D.delBtn.addEventListener('click', async () => {
    if (!D.delBtn.classList.contains('confirm')) {
      D.delBtn.classList.add('confirm');
      D.delBtn.setAttribute('aria-label', '本当に削除する');
      delTimer = setTimeout(resetDelete, 3000);
      return;
    }
    const id = detailId;
    const r = current();
    const name = r ? r.name : '';
    resetDelete();
    ui.close(ov);
    if (!(await store.recipes.trash(id))) return;
    ui.toast(`「${name}」をゴミ箱に移動しました`, {
      label: '元に戻す',
      run: async () => { if (await store.recipes.restore(id)) ui.toast(`「${name}」を元に戻しました`); },
    });
  });

  // ほかの端末・ほかの画面での変更:消えたら閉じる、変わったら描き直す
  store.on('recipes', ({ changed, removed }) => {
    if (!detailId || !ui.isOpen(ov)) return;
    const r = store.recipes.get(detailId);
    if (removed.includes(detailId) || !r) { ui.close(ov); return; }
    if (changed.includes(detailId) && !selfWrite) render(r);
  });
}

// 詳細を開く。servings を渡すとその人数で開く(今日の献立・献立の1品から)
export function openDetail(id, { servings: n, origin } = {}) {
  const r = store.recipes.get(id);
  if (!r) return;
  const already = ui.isOpen(ov);
  if (already && detailId === id) return;
  detailId = id;
  servings = n > 0 ? Math.max(1, Math.min(20, Math.round(n))) : r.servings;
  closeLogForm(true);
  resetDelete();
  render(r);
  D.top.classList.remove('solid');
  if (already) { ov.scrollTop = 0; return; }
  // 大きな写真の展開が動きの途中に入るとカクつくので、先に済ませる(長くても 0.16 秒まで)
  const img = D.hero.querySelector('img');
  const ready = img && img.decode
    ? Promise.race([img.decode().catch(() => {}), new Promise((res) => setTimeout(res, 160))])
    : Promise.resolve();
  ready.then(() => { if (detailId === id) ui.open(ov, origin); });
}
