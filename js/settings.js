// 設定のページ:一覧 → 各項目(同期とアカウント・ボックスと共有・ジャンル・種類・よく使う食材・献立で使う食事・ゴミ箱・アプリ)
// 各項目は ui.pushStep で履歴に積み、「戻る」で一覧へ戻る。ロジックは v1 の app.js(設定・ゴミ箱・バックアップ・インストール)から移植
import { store, MEALS, MEAL_ORDER, MEAL_SHORT, normalizeRecipe } from './store.js';
import * as ui from './ui.js';
import { el, todayStr } from './lib/text.js';
import { ingKey, effectiveStaples } from './lib/ingredients.js';
import { heroImage } from './lib/image.js';
import { testAiKey, aiErrorText, DEFAULT_MODELS } from './lib/ai.js';
import { buildBoxPanel, paintAvatar } from './sharing.js';

const TITLES = {
  main: '設定', account: '同期とアカウント', box: 'ボックスと共有', genres: 'ジャンル', courses: '種類',
  staples: 'よく使う食材', meals: '献立で使う食事', trash: 'ゴミ箱', app: 'アプリ', ai: 'AI で動画を読み取る',
};
// 選択肢の編集(ジャンル・種類・よく使う食材)
const EDITORS = {
  genres: { noun: 'ジャンル', placeholder: '新しいジャンル', hint: 'レシピの登録と絞り込みで使う選択肢です。外しても、登録済みのレシピのジャンルはそのまま残ります。' },
  courses: { noun: '種類', placeholder: '新しい種類', hint: 'メイン・サイドなどの選択肢です。外しても、登録済みのレシピの種類はそのまま残ります。' },
  staples: { noun: 'よく使う食材', placeholder: 'よく使う食材を追加', hint: '' },
};
const CHEV = ui.ICON.chevron.replace('<svg', '<svg class="nl-chev" aria-hidden="true"');
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)'); // 項目の切り替えは JS の animate() なので自分で止める

let ov, root, backBtn, boxPanel;
let cur = 'main';
let spentInstall = null; // prompt() を呼んだあとのイベント(もう使えない)
let clearTimer = 0;
const $ = (sel) => root.querySelector(sel);
const $$ = (sel) => [...root.querySelectorAll(sel)];

export function init() {
  ov = ui.page({ id: 'settings', title: '設定', build });
  backBtn = ov.panel.querySelector('.back-btn');
  // 各項目では「‹」は一覧へ戻る(data-close を外して、自分で履歴を戻す)
  backBtn.addEventListener('click', () => { if (cur !== 'main') ui.back(); });

  store.on('settings', () => { renderSummary(); if (EDITORS[cur]) renderEditor(cur); if (cur === 'meals') renderMeals(); });
  store.on('recipes', () => { renderSummary(); if (cur === 'staples' && ui.isOpen(ov)) renderEditor('staples'); });
  store.on('trash', () => { renderSummary(); if (cur === 'trash' && ui.isOpen(ov)) renderTrash(); });
  ['auth', 'sync'].forEach((ev) => store.on(ev, () => { renderSummary(); renderAccount(); }));
  ['box', 'boxes', 'members'].forEach((ev) => store.on(ev, renderSummary));
  store.on('install', renderApp);
  store.on('loaded', () => { renderSummary(); if (ui.isOpen(ov)) renderPage(cur); });
}

// page を渡すと、その項目を開いた状態で始める(登録画面の「編集」、食材から探すの「編集」など)。戻ると一覧へ
export function openSettings(page = null, origin) {
  const target = page && TITLES[page] && page !== 'main' ? page : null;
  if (!ui.isOpen(ov)) {
    // 開くときは一覧を経由せず、その項目から始める(ページ自体が滑り込むので項目の切り替えは動かさない)
    showPage(target || 'main');
    ui.open(ov, origin);
    if (target) ui.pushStep(ov, () => showPage('main', 'back'));
    return;
  }
  if (target && target !== cur) goPage(target);
}

/* ---------------- 骨組み(作成時に1回) ---------------- */
function build(body) {
  root = body;
  body.innerHTML = `
  <div class="set-pages">
    <div class="set-page" data-page="main">
      <section class="sec">
        <h3 class="sec-h">同期とアカウント</h3>
        <ul class="nav-list"><li><button type="button" data-to="account">
          <span class="avatar" data-acc-avatar></span>
          <span class="nl-text wide"><span class="nl-title" data-acc-title></span><span class="nl-sub acc-sub"><span class="sync-dot" data-acc-dot></span><span data-acc-sync></span></span></span>
          ${CHEV}
        </button></li></ul>
      </section>
      <section class="sec">
        <h3 class="sec-h">ボックスと共有</h3>
        <ul class="nav-list"><li><button type="button" data-to="box">
          <span class="nl-text wide"><span class="nl-title" data-box-title></span><span class="nl-sub" data-box-sub></span></span>
          ${CHEV}
        </button></li></ul>
      </section>
      <section class="sec">
        <h3 class="sec-h">レシピの整理</h3>
        <ul class="nav-list">
          <li><button type="button" data-to="genres"><span class="nl-text"><span class="nl-title">ジャンルを編集</span></span><span class="nl-value" data-sum="genres"></span>${CHEV}</button></li>
          <li><button type="button" data-to="courses"><span class="nl-text"><span class="nl-title">種類を編集</span></span><span class="nl-value" data-sum="courses"></span>${CHEV}</button></li>
          <li><button type="button" data-to="staples"><span class="nl-text"><span class="nl-title">よく使う食材を編集</span></span><span class="nl-value" data-sum="staples"></span>${CHEV}</button></li>
          <li><button type="button" data-to="meals"><span class="nl-text"><span class="nl-title">献立で使う食事</span></span><span class="nl-value" data-sum="meals"></span>${CHEV}</button></li>
          <li><button type="button" data-to="trash"><span class="nl-text"><span class="nl-title">ゴミ箱</span><span class="nl-sub">削除したレシピ(30日間)</span></span><span class="nl-value" data-sum="trash"></span>${CHEV}</button></li>
        </ul>
      </section>
      <section class="sec">
        <h3 class="sec-h">AI</h3>
        <ul class="nav-list"><li><button type="button" data-to="ai">
          <span class="nl-text"><span class="nl-title">AI で動画を読み取る</span><span class="nl-sub">YouTube から材料・作り方を自動で下書き</span></span>
          <span class="nl-value" data-sum="ai"></span>
          ${CHEV}
        </button></li></ul>
      </section>
      <section class="sec">
        <h3 class="sec-h">アプリ</h3>
        <ul class="nav-list"><li><button type="button" data-to="app">
          <span class="nl-text wide"><span class="nl-title">ホーム画面に追加・バックアップ</span></span>
          ${CHEV}
        </button></li></ul>
      </section>
    </div>

    <div class="set-page" data-page="account" hidden>
      <section class="sec">
        <h3 class="sec-h">同期</h3>
        <div class="acc-status" data-acc-status><span class="sync-dot"></span><div class="acc-status-text"><b></b><span></span></div></div>
      </section>
      <section class="sec" data-acc-user hidden>
        <h3 class="sec-h">アカウント</h3>
        <div class="acc-user"><span class="avatar"></span><div class="acc-user-text"><b></b><span></span></div></div>
      </section>
      <div class="sec" data-acc-login hidden>
        <button class="btn primary wide" type="button">Google でログインして同期する</button>
        <p class="hint">ログインすると、この端末に保存してあるレシピ・献立・買い物リストはクラウドに移され、ほかの端末や家族・友だちと同じものが使えます。</p>
      </div>
      <button class="btn ghost danger wide" type="button" data-acc-logout hidden>ログアウト</button>
    </div>

    <div class="set-page" data-page="box" hidden></div>

    ${Object.entries(EDITORS).map(([kind, d]) => `
    <div class="set-page" data-page="${kind}" hidden>
      <p class="hint" data-hint>${d.hint}</p>
      <ul class="edit-chips" data-edit aria-label="${d.noun}"></ul>
      <form class="add-row" novalidate>
        <input maxlength="20" autocomplete="off" enterkeyhint="done" placeholder="${d.placeholder}" aria-label="${d.placeholder}">
        <button class="btn small" type="submit">追加</button>
      </form>
      ${kind === 'staples' ? '<button class="link small staple-auto" type="button" hidden>レシピから自動で選ぶ方法に戻す</button>' : ''}
    </div>`).join('')}

    <div class="set-page" data-page="meals" hidden>
      <p class="hint">献立の画面に出す枠を選びます。オフにしても、すでに入れた料理は消えずに表示されます。</p>
      <div class="switch-list">
        ${MEALS.map((m) => `<label class="switch-row"><span>${m.long}</span><input type="checkbox" data-meal="${m.id}"><span class="switch" aria-hidden="true"></span></label>`).join('')}
      </div>
    </div>

    <div class="set-page" data-page="trash" hidden>
      <p class="hint">削除したレシピは30日間ここに残り、そのあと自動で完全に削除されます。</p>
      <ul class="trash-list" data-trash-list></ul>
      <p class="trash-none" data-trash-none hidden>ゴミ箱は空です</p>
      <button class="btn ghost danger wide" type="button" data-trash-clear hidden>ゴミ箱を空にする</button>
    </div>

    <div class="set-page" data-page="ai" hidden>
      <p class="hint">レシピの登録で YouTube の URL を貼ると、Gemini(Google の AI)が動画の中身を読んで、料理名・材料・作り方を下書きします。使うには Google の API キーが必要です(無料枠で使えます)。</p>
      <ol class="ai-steps-list">
        <li><a class="link" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> を開き、「API キーを作成」で作る</li>
        <li>できたキーをコピーして、下に貼る</li>
      </ol>
      <form class="ai-form" novalidate>
        <div class="field">
          <label for="ai-key">API キー</label>
          <div class="ai-key-row">
            <input id="ai-key" type="password" autocomplete="off" spellcheck="false" placeholder="AQ.… または AIza…" aria-label="API キー">
            <button class="btn small" type="button" data-ai-show aria-pressed="false">表示</button>
          </div>
          <p class="hint">キーは自分のアカウントに保存され、ほかの端末でも使えます。家族や友だちには共有されません。</p>
        </div>
        <details class="ai-adv">
          <summary>使うモデル(ふだんは変えなくてよい)</summary>
          <div class="field">
            <input id="ai-model" type="text" autocomplete="off" spellcheck="false" placeholder="${DEFAULT_MODELS}" aria-label="モデル">
            <p class="hint">カンマで区切ると、混んでいるときに次のモデルで試します。空なら標準(${DEFAULT_MODELS})。</p>
          </div>
        </details>
        <button class="btn primary wide" type="submit" data-ai-save>保存して確かめる</button>
        <p class="hint ai-result" data-ai-result hidden></p>
        <button class="btn ghost danger wide" type="button" data-ai-clear hidden>キーを削除する</button>
      </form>
      <p class="hint">無料枠では、読み取った動画が Google 側の品質向上に使われることがあります。読み取りは短い動画で30秒ほど、15分の動画だと3〜4分かかります。</p>
    </div>

    <div class="set-page" data-page="app" hidden>
      <ul class="app-list">
        <li data-install-row><button type="button" data-install>ホーム画面に追加<span data-install-sub></span></button></li>
        <li><button type="button" data-export>バックアップを書き出す<span>すべてのレシピを1つのファイル(JSON)に保存</span></button></li>
        <li><button type="button" data-import>バックアップを読み込む<span>同じレシピは上書きされます</span></button></li>
      </ul>
      <input type="file" accept="application/json,.json" hidden>
    </div>
  </div>`;

  $$('[data-to]').forEach((b) => b.addEventListener('click', () => goPage(b.dataset.to)));

  // AI のキー
  const aiKey = $('#ai-key'), aiModel = $('#ai-model'), aiShow = $('[data-ai-show]'), aiResult = $('[data-ai-result]');
  aiShow.addEventListener('click', () => {
    const show = aiKey.type === 'password';
    aiKey.type = show ? 'text' : 'password';
    aiShow.textContent = show ? '隠す' : '表示';
    aiShow.setAttribute('aria-pressed', String(show));
  });
  $('.ai-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = aiKey.value.trim(), model = aiModel.value.trim();
    const btn = $('[data-ai-save]');
    if (!key) { aiKey.focus(); return ui.toast('API キーを貼ってください'); }
    btn.disabled = true;
    btn.textContent = '確かめています…';
    aiResult.hidden = true;
    try {
      await testAiKey(key);
      await store.ai.save({ key, model });
      aiResult.className = 'hint ai-result ok';
      aiResult.textContent = 'キーを保存しました。レシピの登録で YouTube の URL を貼ると AI が動きます';
      ui.toast('AI のキーを保存しました');
    } catch (err) {
      aiResult.className = 'hint ai-result bad';
      aiResult.textContent = aiErrorText(err);
    }
    aiResult.hidden = false;
    btn.disabled = false;
    btn.textContent = '保存して確かめる';
  });
  $('[data-ai-clear]').addEventListener('click', async () => {
    await store.ai.save({ key: '' });
    aiKey.value = '';
    aiResult.hidden = true;
    renderAi();
    ui.toast('AI のキーを削除しました');
  });
  store.on('ai', () => { renderSummary(); if (cur === 'ai') renderAi(); });

  // 同期とアカウント
  $('[data-acc-login] button').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'ログインしています…';
    try {
      await store.signIn();
    } catch (err) {
      ui.toast(store.signInErrorText(err));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Google でログインして同期する';
    }
  });
  $('[data-acc-logout]').addEventListener('click', async () => {
    ui.close(ov);
    try { await store.signOut(); } catch { ui.toast('ログアウトできませんでした'); }
  });

  // ボックスと共有(中身は sharing.js)
  boxPanel = buildBoxPanel($('[data-page="box"]'), () => ui.isOpen(ov) && cur === 'box');

  // 選択肢の追加
  Object.keys(EDITORS).forEach((kind) => {
    const page = pageOf(kind);
    const form = page.querySelector('form');
    const input = form.querySelector('input');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = input.value.trim().replace(/\s+/g, ' ');
      if (!name) return input.focus();
      const list = editorList(kind);
      // 食材は「たまご/卵」なども同じものとして重複を防ぐ
      const same = kind === 'staples' ? (x) => ingKey(x) === ingKey(name) : (x) => x === name;
      if (list.some(same)) {
        ui.toast(`「${name}」はすでにあります`);
        return input.select();
      }
      if (list.length >= 30) return ui.toast('これ以上は追加できません(30個まで)');
      input.value = '';
      store.settings.save({ [kind]: [...list, name] });
    });
  });
  $('.staple-auto').addEventListener('click', async () => {
    if (await store.settings.save({ staples: null })) ui.toast('レシピから自動で選ぶようにしました');
  });

  // 献立で使う食事(少なくとも1つ)
  $$('[data-meal]').forEach((i) => i.addEventListener('change', () => {
    const next = MEAL_ORDER.filter((m) => $(`[data-meal="${m}"]`).checked);
    if (!next.length) {
      i.checked = true;
      return ui.toast('少なくとも1つは選んでください');
    }
    store.settings.save({ meals: next });
  }));

  // ゴミ箱を空にする(2段階・3秒で戻る)
  const clear = $('[data-trash-clear]');
  clear.addEventListener('click', () => {
    const n = store.trash.list.length;
    if (!clear.classList.contains('confirm')) {
      clear.classList.add('confirm');
      clear.textContent = `${n}件を完全に削除する`;
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => { clear.classList.remove('confirm'); clear.textContent = 'ゴミ箱を空にする'; }, 3000);
      return;
    }
    clearTimeout(clearTimer);
    store.trash.deleteForever(store.trash.list.map((r) => r.id));
    ui.toast(`${n}件を完全に削除しました`);
  });

  // アプリ:ホーム画面に追加・バックアップ
  $('[data-install]').addEventListener('click', installApp);
  $('[data-export]').addEventListener('click', exportBackup);
  const file = $('[data-page="app"] input[type="file"]');
  $('[data-import]').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files[0];
    file.value = '';
    if (f) importBackup(f);
  });
}

/* ---------------- 一覧 ⇄ 各項目 ---------------- */
const pageOf = (name) => $(`.set-page[data-page="${name}"]`);

function showPage(name, dir) {
  cur = name;
  $$('.set-page').forEach((p) => { p.hidden = p.dataset.page !== name; });
  if (dir && !reducedMotion.matches) {
    pageOf(name).animate(
      [{ opacity: 0, transform: `translateX(${dir === 'back' ? -28 : 28}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 340, easing: 'cubic-bezier(.32,.72,0,1)' }
    );
  }
  ov.setTitle(TITLES[name]);
  const main = name === 'main';
  if (main) backBtn.dataset.close = ''; else delete backBtn.dataset.close;
  backBtn.setAttribute('aria-label', main ? '閉じる' : '設定の一覧に戻る');
  ov.scrollTop = 0;
  renderPage(name);
}

// 進むたびに履歴を1つ積み、「戻る」で一覧へ。すでに項目を開いていれば差し替えるだけ
function goPage(name) {
  if (cur !== 'main') { showPage(name, 'forward'); return; }
  showPage(name, 'forward');
  ui.pushStep(ov, () => showPage('main', 'back'));
}

function renderPage(name) {
  if (name === 'main') renderSummary();
  else if (name === 'account') renderAccount();
  else if (name === 'box') boxPanel.show();
  else if (EDITORS[name]) renderEditor(name);
  else if (name === 'meals') renderMeals();
  else if (name === 'trash') renderTrash();
  else if (name === 'app') renderApp();
  else if (name === 'ai') renderAi();
}

function renderAi() {
  const a = store.ai;
  const key = $('#ai-key');
  if (document.activeElement !== key) key.value = a.key;
  const model = $('#ai-model');
  if (document.activeElement !== model) model.value = a.model;
  $('[data-ai-clear]').hidden = !a.key;
}

// 設定の配列(読み込み前は store.settings が空なので、無ければ空の配列)
const settingList = (kind) => (Array.isArray(store.settings[kind]) ? store.settings[kind] : []);

// 一覧に、それぞれの今の中身を短く出す
function renderSummary() {
  const s = store.settings;
  const join = (list) => (list.length ? list.join('・') : 'なし');
  const sum = {
    genres: join(settingList('genres')), courses: join(settingList('courses')),
    staples: Array.isArray(s.staples) ? `${s.staples.length}品` : '自動',
    meals: settingList('meals').map((m) => MEAL_SHORT[m]).join('・'),
    trash: store.trash.list.length ? `${store.trash.list.length}件` : '',
    ai: store.ai.key ? '設定済み' : '未設定',
  };
  Object.entries(sum).forEach(([k, v]) => { $(`[data-sum="${k}"]`).textContent = v; });

  const u = store.user;
  paintAvatar($('[data-acc-avatar]'), u);
  $('[data-acc-title]').textContent = u ? u.name || u.email || 'Google アカウント' : 'ログインしていません';
  $('[data-acc-dot]').dataset.state = store.sync.state;
  $('[data-acc-sync]').textContent = store.syncText().title;

  const box = store.box;
  const cloud = store.mode === 'cloud' && u;
  $('[data-box-title]').textContent = box.name;
  $('[data-box-sub]').textContent = !cloud ? 'ログインすると家族や友だちと共有できます'
    : box.isMine ? (store.members.length ? `あなたのボックス · メンバー ${store.members.length + 1}人` : 'あなたのボックス')
      : box.ownerName ? `${box.ownerName}さんのボックス` : '参加しているボックス';
}

/* ---------------- 同期とアカウント ---------------- */
function renderAccount() {
  const u = store.user;
  const { title, sub } = store.syncText();
  const status = $('[data-acc-status]');
  status.dataset.state = store.sync.state;
  status.querySelector('.sync-dot').dataset.state = store.sync.state;
  status.querySelector('b').textContent = title;
  status.querySelector('.acc-status-text span').textContent = sub;

  const userSec = $('[data-acc-user]');
  userSec.hidden = !u;
  if (u) {
    paintAvatar(userSec.querySelector('.avatar'), u);
    userSec.querySelector('b').textContent = u.name || 'Google アカウント';
    userSec.querySelector('.acc-user-text span').textContent = u.email || '';
  }
  $('[data-acc-login]').hidden = !!u || !store.hasCloud;
  $('[data-acc-logout]').hidden = !u;
}

/* ---------------- 選択肢の編集(ジャンル・種類・よく使う食材) ---------------- */
// よく使う食材は「自動」のときもあるので、編集用の一覧はここから取る
const editorList = (kind) => (kind === 'staples' ? effectiveStaples(store.settings, store.recipes.list) : settingList(kind));

function renderEditor(kind) {
  const page = pageOf(kind);
  const ul = page.querySelector('[data-edit]');
  const list = editorList(kind);
  ul.innerHTML = '';
  if (!list.length) ul.append(el('li', 'empty-note', `${EDITORS[kind].noun}はまだありません`));
  list.forEach((name) => {
    const li = el('li');
    li.append(el('span', null, name));
    const del = el('button');
    del.type = 'button';
    del.innerHTML = ui.ICON.close;
    del.setAttribute('aria-label', `「${name}」を選択肢から外す`);
    del.onclick = async () => {
      if (await store.settings.save({ [kind]: editorList(kind).filter((x) => x !== name) })) ui.toast(`「${name}」を選択肢から外しました`);
    };
    li.append(del);
    ul.append(li);
  });
  if (kind === 'staples') {
    const auto = !Array.isArray(store.settings.staples);
    page.querySelector('.staple-auto').hidden = auto;
    page.querySelector('[data-hint]').textContent = auto
      ? 'いまは、登録したレシピによく出てくる食材を自動で表示しています。追加・削除すると、この内容で固定されます。'
      : '「冷蔵庫の食材から探す」で、ワンタップで入れられる食材です。';
  }
}

function renderMeals() {
  $$('[data-meal]').forEach((i) => { i.checked = settingList('meals').includes(i.dataset.meal); });
}

/* ---------------- ゴミ箱 ---------------- */
function renderTrash() {
  const ul = $('[data-trash-list]');
  ul.innerHTML = '';
  const list = [...store.trash.list].sort((a, b) => b.deletedAt - a.deletedAt);
  list.forEach((r) => {
    const li = el('li', 'trash-item');
    const thumb = el('span', 'tr-thumb');
    const img = heroImage(r);
    if (img) thumb.append(img); else thumb.textContent = '🍽';
    const text = el('span', 'tr-text');
    const left = store.trash.daysLeft(r);
    text.append(el('b', null, r.name), el('span', null, left <= 1 ? 'まもなく完全に削除されます' : `あと${left}日で完全に削除`));
    const restore = el('button', 'btn small', '元に戻す');
    restore.type = 'button';
    restore.onclick = async () => { if (await store.recipes.restore(r.id)) ui.toast(`「${r.name}」を元に戻しました`); };
    // 完全に削除は取り消せないので2段階(3秒で戻る)
    const del = el('button', 'tr-del');
    del.type = 'button';
    del.innerHTML = ui.ICON.trash;
    del.setAttribute('aria-label', `「${r.name}」を完全に削除`);
    del.onclick = () => {
      if (!del.classList.contains('confirm')) {
        del.classList.add('confirm');
        del.append(el('span', null, '完全に削除'));
        setTimeout(() => { if (del.isConnected) { del.classList.remove('confirm'); del.innerHTML = ui.ICON.trash; } }, 3000);
        return;
      }
      store.trash.deleteForever([r.id]);
      ui.toast(`「${r.name}」を完全に削除しました`);
    };
    li.append(thumb, text, restore, del);
    ul.append(li);
  });
  $('[data-trash-none]').hidden = list.length > 0 || !store.loaded;
  const clear = $('[data-trash-clear]');
  clear.hidden = !list.length;
  clear.classList.remove('confirm');
  clear.textContent = 'ゴミ箱を空にする';
}

/* ---------------- アプリ:ホーム画面に追加・バックアップ ---------------- */
const installEvent = () => (store.install && store.install !== spentInstall ? store.install : null);

function renderApp() {
  // すでにアプリとして開いているときは「ホーム画面に追加」を出さない
  $('[data-install-row]').hidden = isStandalone();
  $('[data-install-sub]').textContent = installEvent()
    ? 'アプリのように全画面で使えます'
    : 'Chrome のメニュー(⋮)→「ホーム画面に追加」からも追加できます';
}

async function installApp() {
  const e = installEvent();
  if (!e) {
    ui.toast('Chrome のメニュー(⋮)→「ホーム画面に追加」から追加してください');
    return;
  }
  spentInstall = e;
  e.prompt();
  const choice = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
  renderApp();
  if (choice.outcome === 'accepted') ui.close(ov);
}

function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: 'recipe-box', version: 2, recipes: store.recipes.list })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `recipes-${todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  ui.toast('書き出しました');
}

async function importBackup(file) {
  let list;
  try {
    const data = JSON.parse(await file.text());
    list = (Array.isArray(data) ? data : (data && data.recipes) || []).filter((r) => r && r.id && r.name);
  } catch {
    return ui.toast('読み込めないファイルです');
  }
  if (!list.length) return ui.toast('レシピが入っていないファイルです');
  let ok = 0;
  // 大きすぎる1件があっても残りは読み込む(失敗は store が知らせる)
  for (const raw of list) if (await store.recipes.put(normalizeRecipe(raw))) ok++;
  ui.toast(ok === list.length ? `${ok} 件を読み込みました` : `${ok} 件を読み込みました(${list.length - ok} 件は大きすぎて読み込めませんでした)`);
}
