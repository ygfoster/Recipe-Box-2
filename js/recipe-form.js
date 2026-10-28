// レシピの登録・編集:全画面ページ。写真(選択・ドロップ・圧縮)、参考動画の URL(プレビュー、YouTube ならタイトルを料理名に自動入力、
// API キーがあれば概要欄から材料・作り方・人数を自動入力)、料理名(必須)、ジャンル・種類、調理時間/人数、タグ、材料、作り方、メモ
// 共有メニューからの登録は app.js が openForm(null, preset) で呼ぶ。v1 の app.js(Form)から移植
import { store } from './store.js';
import * as ui from './ui.js';
import { el, uid, replay } from './lib/text.js';
import { videoInfo, fetchVideoTitle, fetchYouTubeDetails, descriptionToRecipe } from './lib/video.js';
import { hasAi, extractRecipeFromVideo, extractToText, aiErrorText } from './lib/ai.js';
import { compressImage, makeImg } from './lib/image.js';
import { openSettings } from './settings.js';
import { currentFilter, revealList } from './recipes.js';

const CAMERA = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 016.5 6h1.2l1.1-1.6A1.5 1.5 0 0110 3.7h4a1.5 1.5 0 011.2.7L16.3 6h1.2A2.5 2.5 0 0120 8.5v8a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 16.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="12.5" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

let ov;
const F = {}; // 画面の部品
let editingId = null;
let photo = null;
let formGenre = '';
let formCourse = '';
let saving = false;
let videoTimer, videoSeq = 0;
let aiAbort = null; // 読み取り中の AI 呼び出し(URL が変わったら止める)
let aiOv = null;    // 読み取り結果の確認シート
let aiResult = null;
let autoName = '';  // 動画タイトルから自動で入れた料理名(AI の料理名で置き換えてよい)

/* ---------------- 部品づくり ---------------- */
function field(labelText, input, id) {
  const f = el('div', 'field');
  const l = el('label', null, labelText);
  l.htmlFor = id;
  input.id = id;
  f.append(l, input);
  return f;
}
function input(type, attrs = {}) {
  const i = el('input');
  i.type = type;
  Object.assign(i, attrs);
  return i;
}
function textarea(rows, placeholder) {
  const t = el('textarea');
  t.rows = rows;
  t.placeholder = placeholder;
  return t;
}
// ジャンル・種類の選択(「編集」で設定へ)
function pickField(labelText, kind) {
  const f = el('div', 'field');
  const row = el('div', 'lbl-row');
  const edit = el('button', 'link small', '編集');
  edit.type = 'button';
  edit.onclick = () => openSettings(kind, edit);
  row.append(el('span', 'lbl', labelText), edit);
  const box = el('div', 'picks');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', labelText);
  f.append(row, box);
  return { f, box };
}

function autoGrow(t) {
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 2 + 'px';
}

function build(body, o) {
  F.form = el('form', 'rform');
  F.form.noValidate = true;

  // 写真(選ぶ・ドロップ)
  F.photoDrop = el('label', 'photo');
  F.photoInput = input('file', { accept: 'image/*' });
  F.photoInput.hidden = true;
  F.photoInput.setAttribute('aria-label', '写真を選ぶ');
  F.photoPrev = el('img');
  F.photoPrev.alt = '';
  F.photoPrev.hidden = true;
  F.photoHint = el('div', 'photo-hint');
  F.photoHint.innerHTML = CAMERA;
  F.photoHint.append(el('span', null, '写真を選ぶ、またはドロップ'), el('small', null, '写真がなければ動画のサムネイルを使います'));
  F.photoRemove = el('button', 'photo-remove', '写真を外す');
  F.photoRemove.type = 'button';
  F.photoRemove.hidden = true;
  F.photoDrop.append(F.photoInput, F.photoPrev, F.photoHint, F.photoRemove);

  // 参考動画
  F.video = input('url', { inputMode: 'url', autocomplete: 'off', placeholder: 'YouTube・Instagram・TikTok などのURL' });
  const videoField = field('参考動画のURL', F.video, 'rf-video');
  F.videoPrev = el('div', 'video-prev');
  F.videoPrev.hidden = true;
  videoField.append(F.videoPrev);

  // 料理名(必須)
  F.name = input('text', { maxLength: 80, autocomplete: 'off', placeholder: '例:肉じゃが' });
  F.nameField = field('料理名', F.name, 'rf-name');

  const genre = pickField('ジャンル', 'genres');
  F.genrePicks = genre.box;
  const course = pickField('種類', 'courses');
  F.coursePicks = course.box;

  // 調理時間 / 人数
  const row = el('div', 'field-row');
  F.time = input('number', { inputMode: 'numeric', min: 1, max: 999, placeholder: '20' });
  const timeField = field('調理時間', F.time, 'rf-time');
  const timeWrap = el('div', 'suffix');
  timeWrap.append(F.time, el('span', null, '分'));
  timeField.append(timeWrap);
  F.serv = input('number', { inputMode: 'numeric', min: 1, max: 20, placeholder: '2' });
  const servField = field('人数', F.serv, 'rf-serv');
  const servWrap = el('div', 'suffix');
  servWrap.append(F.serv, el('span', null, '人分'));
  servField.append(servWrap);
  row.append(timeField, servField);

  // タグ・材料・作り方・メモ
  F.tags = input('text', { maxLength: 120, autocomplete: 'off', placeholder: '作り置き　お弁当　時短' });
  const tagsField = field('タグ', F.tags, 'rf-tags');
  tagsField.append(el('p', 'hint', 'スペースで区切ります(全角・半角どちらでも)'));
  F.ing = textarea(3, 'じゃがいも 3個\n牛肉 200g\n醤油 大さじ2');
  const ingField = field('材料', F.ing, 'rf-ing');
  ingField.append(el('p', 'hint', '1行に1つ。名前と量をスペースで区切ると、人数に合わせて分量を計算します。「【タレ】」のように書くと見出しになります。'));
  F.steps = textarea(4, '0:45 じゃがいもを切る\n2:10 中火で10分煮る');
  const stepsField = field('作り方', F.steps, 'rf-steps');
  stepsField.append(el('p', 'hint', '1行に1手順。行頭に「1:23」のように動画の時間を書くと、手順をタップしてその場面から再生できます。「10分煮る」などの時間はタイマーになります。'));
  F.memo = textarea(2, 'コツ、参考にしたページなど');
  const memoField = field('メモ', F.memo, 'rf-memo');

  F.save = el('button', 'btn primary wide save-wide', '保存');
  F.save.type = 'submit';

  F.form.append(F.photoDrop, videoField, F.nameField, genre.f, course.f, row, tagsField, ingField, stepsField, memoField, F.save);
  body.append(F.form);

  // 見出し行の右にも「保存」(長いフォームでもすぐ押せる)
  F.saveTop = el('button', 'btn small primary', '保存');
  F.saveTop.type = 'button';
  F.saveTop.onclick = () => submit();
  o.tools.append(F.saveTop);
}

/* ---------------- ジャンル・種類(もう一度押すと外せる) ---------------- */
function renderPicks(box, kind) {
  const key = kind === 'genres' ? 'genre' : 'course';
  const cur = key === 'genre' ? formGenre : formCourse;
  const opts = [...(store.settings[kind] || [])];
  // 選択肢から外した値のレシピを編集するときも、今の値は選べるように残す
  if (cur && !opts.includes(cur)) opts.push(cur);
  box.innerHTML = '';
  if (!opts.length) box.append(el('p', 'picks-empty', '選択肢がありません。「編集」から追加できます'));
  opts.forEach((c) => {
    const on = c === cur;
    const b = el('button', 'chip' + (on ? ' active' : ''), c);
    b.type = 'button';
    b.title = c;
    b.setAttribute('aria-pressed', String(on));
    b.onclick = () => {
      const next = on ? '' : c;
      if (key === 'genre') formGenre = next; else formCourse = next;
      renderPicks(box, kind);
    };
    box.append(b);
  });
}
function renderAllPicks() {
  renderPicks(F.genrePicks, 'genres');
  renderPicks(F.coursePicks, 'courses');
}

/* ---------------- 写真 ---------------- */
function setPhoto(dataUrl) {
  photo = dataUrl;
  if (dataUrl) {
    F.photoPrev.src = dataUrl;
    F.photoPrev.hidden = false;
    replay(F.photoPrev, 'pop-in');
  } else {
    F.photoPrev.removeAttribute('src');
    F.photoPrev.hidden = true;
  }
  F.photoHint.hidden = !!dataUrl;
  F.photoRemove.hidden = !dataUrl;
  F.photoDrop.classList.toggle('filled', !!dataUrl);
}
async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return ui.toast('画像ファイルを選んでください');
  try {
    setPhoto(await compressImage(file));
  } catch {
    ui.toast('この画像は読み込めませんでした');
  }
}

/* ---------------- 動画 URL → プレビューと自動入力 ---------------- */
function renderVideoPreview(autofill) {
  const box = F.videoPrev;
  const val = F.video.value.trim();
  const v = videoInfo(val);
  box.className = 'video-prev';
  box.innerHTML = '';
  if (!val) { box.hidden = true; return; }
  box.hidden = false;
  if (!v) {
    box.classList.add('bad');
    box.textContent = 'URL の形式を確認してください(https:// から始まるURL)';
    return;
  }
  const thumb = el('span', 'vp-thumb');
  if (v.thumb) {
    const img = makeImg(v.thumb);
    img.referrerPolicy = 'no-referrer';
    thumb.append(img);
  } else thumb.textContent = '🔗';
  const text = el('span', 'vp-text');
  const title = el('b', null, v.type === 'youtube' ? '動画を確認しています…' : `${v.label} のリンク`);
  text.append(title, el('span', null, v.type === 'youtube'
    ? 'アプリ内の小窓で再生できます'
    : 'アプリ内では再生できないため、ボタンから元のアプリで開きます'));
  box.append(thumb, text);
  if (v.type !== 'youtube') return;

  const seq = ++videoSeq;
  Promise.all([fetchYouTubeDetails(v.id), fetchVideoTitle(v.url)]).then(([details, t0]) => {
    if (seq !== videoSeq) return;
    const t = (details && details.title) || t0;
    title.textContent = t || 'YouTube の動画';
    const filled = [];
    if (t && autofill && !F.name.value.trim()) {
      F.name.value = t.slice(0, 80);
      autoName = F.name.value;
      replay(F.name, 'filled-flash');
      filled.push('料理名');
    }
    let fromDescription = false;
    if (details) {
      const parsed = descriptionToRecipe(details.description);
      if (!parsed) {
        if (!hasAi()) text.append(el('span', 'vp-note', '概要欄に材料・作り方は見つかりませんでした'));
      } else if (autofill && !F.ing.value.trim() && !F.steps.value.trim()) {
        applyDescription(parsed);
        filled.push('材料', '作り方');
        fromDescription = true;
      } else {
        // すでに書いてあるときは、勝手に上書きせずボタンで選べるようにする
        const b = el('button', 'link small vp-apply', '概要欄の材料・作り方で置き換える');
        b.type = 'button';
        b.onclick = () => { applyDescription(parsed); b.remove(); ui.toast('概要欄の材料と作り方に置き換えました'); };
        text.append(b);
        fromDescription = true;
      }
    }
    if (filled.length) ui.toast(`動画から${filled.join('・')}を入れました。内容を確認してください`);
    // AI(Gemini)で動画の中身を読む。材料・作り方が空のときは自動で始め、そうでなければボタンで
    if (hasAi()) {
      const auto = autofill && !fromDescription && !F.ing.value.trim() && !F.steps.value.trim();
      mountAi(text, v, t || '', seq, auto);
    } else if (!fromDescription) {
      // キー未設定:設定へ誘導
      const b = el('button', 'link small vp-apply', 'AI で動画から材料・作り方を読み取る(設定が必要)');
      b.type = 'button';
      b.onclick = () => openSettings('ai', b);
      text.append(b);
    }
  });
}

/* ---------------- AI(Gemini)で動画からレシピを読み取る ---------------- */
// 進行中の読み取りを止め、届きかけの結果も捨てる(画面を閉じた・別のレシピを開いた・URL を変えた)
function stopAi() {
  videoSeq++;
  clearTimeout(videoTimer);
  if (aiAbort) { aiAbort.abort(); aiAbort = null; }
  if (aiOv && ui.isOpen(aiOv)) ui.closeNow(aiOv);
  aiResult = null;
}
function mountAi(text, v, title, seq, auto) {
  const box = el('div', 'ai-box');
  text.append(box);
  const idle = () => {
    box.innerHTML = '';
    const b = el('button', 'ai-btn');
    b.type = 'button';
    b.innerHTML = ui.ICON.sparkle + 'AI で動画から材料・作り方を読み取る';
    b.onclick = () => run();
    box.append(b);
  };
  const run = async () => {
    if (aiAbort) aiAbort.abort();
    const ctrl = (aiAbort = new AbortController());
    box.innerHTML = '';
    const st = el('span', 'ai-status');
    const sec = el('b');
    st.innerHTML = '<span class="ai-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
    st.append('AI が動画を読み取っています… ', sec, el('span', 'ai-note', '(短い動画で30秒ほど。15分の動画だと3〜4分)'));
    // 経過秒数(長い動画でも止まっていないと分かるように)
    const t0 = Date.now();
    const tick = setInterval(() => { sec.textContent = `${Math.round((Date.now() - t0) / 1000)}秒`; }, 1000);
    box.append(st);
    try {
      const r = await extractRecipeFromVideo({ url: v.url, title }, { signal: ctrl.signal });
      clearInterval(tick);
      if (seq !== videoSeq || ctrl.signal.aborted || !ui.isOpen(ov)) return;
      box.innerHTML = '';
      const again = el('button', 'link small', '読み取り結果をもう一度見る');
      again.type = 'button';
      again.onclick = () => openAiPreview(r);
      box.append(el('span', 'ai-done', '読み取れました'), again);
      openAiPreview(r);
    } catch (e) {
      clearInterval(tick);
      if (seq !== videoSeq || ctrl.signal.aborted || (e && e.code === 'aborted')) return;
      box.innerHTML = '';
      box.append(el('span', 'ai-error', aiErrorText(e)));
      const retry = el('button', 'link small', 'もう一度');
      retry.type = 'button';
      retry.onclick = () => run();
      box.append(retry);
    }
  };
  if (auto) run(); else idle();
}

function openAiPreview(r) {
  aiResult = r;
  if (!aiOv) {
    aiOv = ui.sheet({ id: 'ai-preview', eyebrow: 'AI の読み取り結果', build: buildAiPreview });
  }
  renderAiPreview(r);
  ui.open(aiOv);
}

const A = {};
function buildAiPreview(body) {
  A.warn = el('p', 'ai-warn');
  A.meta = el('p', 'ai-meta');
  A.ing = el('ul', 'ai-list');
  A.steps = el('ol', 'ai-list ai-steps');
  A.tags = el('p', 'ai-tags');
  A.notes = el('p', 'ai-notes');
  const foot = el('div', 'ai-foot');
  const cancel = el('button', 'btn ghost', 'やめる');
  cancel.type = 'button';
  cancel.onclick = () => ui.close(aiOv);
  const apply = el('button', 'btn primary', 'この内容で入れる');
  apply.type = 'button';
  apply.onclick = () => { applyAi(aiResult); ui.close(aiOv); };
  foot.append(cancel, apply);
  body.append(A.warn, A.meta, el('h4', 'ai-h', '材料'), A.ing, el('h4', 'ai-h', '作り方'), A.steps, A.tags, A.notes,
    el('p', 'hint', '読み取りは AI なので間違うことがあります。入れたあとで直せます。'), foot);
}

function renderAiPreview(r) {
  aiOv.setTitle(r.name || '(料理名が読み取れませんでした)');
  A.warn.hidden = r.confidence !== 'low';
  A.warn.textContent = '料理のレシピ動画ではないかもしれません。内容をよく確認してください。';
  A.meta.textContent = [r.servings ? `${r.servings}人分` : '', r.timeMinutes ? `${r.timeMinutes}分` : ''].filter(Boolean).join(' · ') || '人数・時間は読み取れませんでした';
  A.ing.innerHTML = '';
  let group = '';
  if (!r.ingredients.length) A.ing.append(el('li', 'ai-empty', '読み取れませんでした'));
  r.ingredients.forEach((x) => {
    if (x.group && x.group !== group) { group = x.group; A.ing.append(el('li', 'ai-group', group)); }
    const li = el('li');
    li.append(el('span', null, x.name), el('span', 'ai-amt', x.amount || '—'));
    A.ing.append(li);
  });
  A.steps.innerHTML = '';
  if (!r.steps.length) A.steps.append(el('li', 'ai-empty', '読み取れませんでした'));
  r.steps.forEach((x) => {
    const li = el('li');
    if (x.startSec >= 0) li.append(el('span', 'ai-time', `${Math.floor(x.startSec / 60)}:${String(x.startSec % 60).padStart(2, '0')}`));
    li.append(el('span', null, x.text));
    A.steps.append(li);
  });
  A.tags.hidden = !r.tags.length;
  A.tags.textContent = r.tags.map((t) => `#${t}`).join('  ');
  A.notes.hidden = !r.notes;
  A.notes.textContent = r.notes;
}

// 読み取った内容を登録画面に入れる(料理名は空か動画タイトルのままのときだけ。材料・作り方は置き換え)
function applyAi(r) {
  if (!r) return;
  const t = extractToText(r);
  const curName = F.name.value.trim();
  if (r.name && (!curName || curName === autoName)) { F.name.value = r.name; autoName = ''; replay(F.name, 'filled-flash'); }
  if (t.ingredients) { F.ing.value = t.ingredients; autoGrow(F.ing); replay(F.ing, 'filled-flash'); }
  if (t.steps) { F.steps.value = t.steps; autoGrow(F.steps); replay(F.steps, 'filled-flash'); }
  if (r.servings) F.serv.value = r.servings;
  if (r.timeMinutes) F.time.value = r.timeMinutes;
  if (r.tags.length) {
    const cur = F.tags.value.split(/[\s\u3000]+/).filter(Boolean);
    F.tags.value = [...new Set([...cur, ...r.tags])].join(' ');
  }
  if (r.notes && !F.memo.value.trim()) { F.memo.value = r.notes; autoGrow(F.memo); }
  ui.toast('AI の読み取り結果を入れました。内容を確認してください');
}

function applyDescription(p) {
  if (p.ingredients.length) { F.ing.value = p.ingredients.join('\n'); autoGrow(F.ing); replay(F.ing, 'filled-flash'); }
  if (p.steps.length) { F.steps.value = p.steps.join('\n'); autoGrow(F.steps); replay(F.steps, 'filled-flash'); }
  if (p.servings) F.serv.value = Math.min(20, p.servings);
}

/* ---------------- 保存 ---------------- */
async function submit() {
  if (saving) return;
  const name = F.name.value.trim();
  if (!name) {
    replay(F.nameField, 'shake');
    F.name.focus();
    return;
  }
  const prev = editingId ? store.recipes.get(editingId) : null;
  const recipe = {
    ...(prev || {}),
    id: prev ? prev.id : uid(),
    name,
    genre: formGenre,
    course: formCourse,
    time: F.time.value,
    servings: F.serv.value || 2,
    tags: F.tags.value.split(/[\s　]+/),
    photo,
    videoUrl: F.video.value.trim(),
    ingredients: F.ing.value.trim(),
    steps: F.steps.value.trim(),
    memo: F.memo.value.trim(),
    createdAt: prev ? prev.createdAt : Date.now(),
    updatedAt: Date.now(),
  };
  saving = true;
  F.save.disabled = F.saveTop.disabled = true;
  let ok = false;
  try { ok = await store.recipes.put(recipe); } finally {
    saving = false;
    F.save.disabled = F.saveTop.disabled = false;
  }
  if (!ok) return; // 失敗の案内は store が出す
  ui.close(ov);
  ui.toast(prev ? '更新しました' : '保存しました');
  if (!prev) revealList();
}

export function init() {
  ov = ui.page({ id: 'form', title: '新しいレシピ', build, onClose: stopAi });
  F.form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  F.form.querySelectorAll('textarea').forEach((t) => t.addEventListener('input', () => autoGrow(t)));
  F.video.addEventListener('input', () => {
    stopAi();
    videoTimer = setTimeout(() => renderVideoPreview(true), 350);
  });
  F.photoInput.addEventListener('change', () => { handleFile(F.photoInput.files[0]); F.photoInput.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => F.photoDrop.addEventListener(ev, (e) => { e.preventDefault(); F.photoDrop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => F.photoDrop.addEventListener(ev, (e) => { e.preventDefault(); F.photoDrop.classList.remove('drag'); }));
  F.photoDrop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
  F.photoRemove.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setPhoto(null); });
  // 設定で選択肢を変えたら(「編集」から戻ってきたら)選べるものを更新する
  store.on('settings', () => { if (ui.isOpen(ov)) renderAllPicks(); });
  // 編集中のレシピがほかで消えたら閉じる(ボックスの切り替えも)
  store.on('recipes', ({ removed }) => {
    if (editingId && ui.isOpen(ov) && (removed.includes(editingId) || !store.recipes.get(editingId))) ui.close(ov);
  });
}

// id を渡すと編集、無ければ新規。preset = { name?, videoUrl?, memo? }(共有メニューから)
export function openForm(id = null, preset = {}) {
  stopAi();
  const r = id ? store.recipes.get(id) : null;
  editingId = r ? r.id : null;
  ov.setTitle(r ? 'レシピを編集' : '新しいレシピ');
  const f = currentFilter();
  F.name.value = r ? r.name : preset.name || '';
  autoName = '';
  F.video.value = r ? r.videoUrl : preset.videoUrl || '';
  formGenre = r ? r.genre : (f.genre !== 'all' ? f.genre : '');
  formCourse = r ? r.course : (f.course !== 'all' ? f.course : '');
  F.time.value = r && r.time ? r.time : '';
  F.serv.value = r ? r.servings : 2;
  F.tags.value = r ? r.tags.join(' ') : '';
  F.ing.value = r ? r.ingredients : '';
  F.steps.value = r ? r.steps : '';
  F.memo.value = r ? r.memo : preset.memo || '';
  setPhoto(r ? r.photo : null);
  renderAllPicks();
  renderVideoPreview(!r);
  F.nameField.classList.remove('shake');
  ui.open(ov);
  const grow = () => F.form.querySelectorAll('textarea').forEach(autoGrow);
  requestAnimationFrame(grow);
  setTimeout(grow, 120);
}
