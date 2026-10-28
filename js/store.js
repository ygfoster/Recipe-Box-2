// データ層:状態(recipes / trash / plan / shop / settings / box / sync / user)、IndexedDB('recipe-box-2')、
// クラウド(cloud.js)との切り替え、ボックス(共有)、同期状態、イベント。v1 の app.js / plan.js / cloud.js から移植
// データの形(既定値・整形)は lib/model.js にあり、ここから再 export する
import { emitter } from './lib/text.js';
import { openDb } from './lib/idb.js';
import {
  DEFAULT_SETTINGS, MEAL_ORDER, MEAL_SHORT, MEALS, COURSE_MAP, TRASH_DAYS, MAX_DOC, INVITE_CHARS, INVITE_DAYS,
  needsMigration, normalizeSettings, normalizeRecipe, normalizeEntry, normalizeShopItem,
} from './lib/model.js';
import { toast } from './ui.js';
import * as cloud from './cloud.js';

export * from './lib/model.js';

/* ---------------- この端末だけの設定(localStorage、'rb2:' 接頭辞) ---------------- */
export const prefs = {
  get(k, d) { try { const v = localStorage.getItem('rb2:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rb2:' + k, JSON.stringify(v)); } catch { /* 保存できなくても動作は続ける */ } },
  del(k) { try { localStorage.removeItem('rb2:' + k); } catch { /* 同上 */ } },
};

/* ---------------- IndexedDB(ログインしていないときの保存先。v1 の 'recipe-box' には触らない) ---------------- */
const db = openDb({
  name: 'recipe-box-2',
  version: 1,
  stores: ['recipes', 'plan', 'shopping'],
  onBlocked: () => toast('ほかのタブで開いているレシピボックス2を閉じてください'),
  onVersionChange: () => toast('アプリが更新されました。開き直してください'),
});

/* ---------------- 状態 ---------------- */
const ev = emitter();
const LOCAL_BOX = { ownerUid: null, ownerName: '', name: 'マイボックス', isMine: true };
const S = {
  mode: 'local', // 'local' | 'cloud'
  cloud: null, // cloud.init() が返した API(偽クラウドに差し替え可)
  user: null,
  loaded: false,
  recipes: [], trash: [], plan: [], shop: [], members: [],
  box: { ...LOCAL_BOX },
  boxes: [{ ...LOCAL_BOX }],
  joined: [], // meta/boxes に書く形 [{ ownerUid, ownerName, joinedAt }]
  subscribed: null, // 購読中のボックスの ownerUid
  sync: { state: 'local', error: '' },
  fromCache: true, pending: false,
};
let unsubAuth = null, unsubBoxes = null, unsubBox = [];

// settings はデータの入れ物そのもの(store.settings.genres …)。save はメソッドだが列挙されない
const settings = {};
Object.defineProperty(settings, 'save', { value: (next) => saveSettings(next), enumerable: false });
const settingsData = () => normalizeSettings(settings);
function applySettings(next) {
  const changed = JSON.stringify(next) !== JSON.stringify(settingsData());
  Object.keys(settings).forEach((k) => delete settings[k]);
  Object.assign(settings, next);
  if (changed) ev.emit('settings', settings);
  refreshBoxNames();
}

const getRecipe = (id) => S.recipes.find((r) => r.id === id);
const getTrash = (id) => S.trash.find((r) => r.id === id);
const trashDaysLeft = (r) => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - r.deletedAt) / 864e5));
const err = (code) => Object.assign(new Error(code), { code });
const withTimeout = (p, ms = 15000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(err('network')), ms))]);

// 有効なレシピとゴミ箱に振り分ける
function placeRecipe(r) {
  S.recipes = S.recipes.filter((x) => x.id !== r.id);
  S.trash = S.trash.filter((x) => x.id !== r.id);
  (r.deletedAt ? S.trash : S.recipes).push(r);
}

function saveErrorText(e) {
  return e && e.message === 'too-large'
    ? '写真が大きすぎて保存できません。写真を減らすか、別の写真にしてください'
    : '保存できませんでした(容量不足の可能性があります)';
}

function clearData() {
  S.recipes = []; S.trash = []; S.plan = []; S.shop = []; S.members = [];
  S.loaded = false;
  applySettings(normalizeSettings(null));
  ev.emit('recipes', { changed: [], removed: [] });
  ev.emit('trash');
  ev.emit('plan');
  ev.emit('shop');
  ev.emit('members', S.members);
}

/* ---------------- 同期の状態 ---------------- */
const SYNC_TEXT = {
  local: ['この端末だけに保存しています', cloud.hasCloud ? 'ログインすると、ほかの端末や家族と同期できます' : 'ほかの端末へはバックアップで移せます'],
  syncing: ['同期しています…', '変更をクラウドに送っています'],
  synced: ['同期済み', 'ほかの端末でも同じ内容が見られます'],
  offline: ['オフライン', '変更はこの端末に保存され、つながったときに同期します'],
  error: ['同期できませんでした', ''],
};
function setSync(state, error = '') {
  if (S.sync.state === state && S.sync.error === error) return;
  S.sync = { state, error };
  ev.emit('sync', S.sync);
}
// Firestore の状態とネットワークから、いまの同期状態を決める(v1 の evalSync)
function evalSync(justWrote) {
  if (S.mode !== 'cloud') return setSync('local');
  if (S.sync.state === 'error' && !justWrote) return;
  if (justWrote) S.pending = true;
  if (!navigator.onLine) return setSync('offline');
  setSync(S.pending || S.fromCache ? 'syncing' : 'synced');
}

/* ---------------- 書き込み(画面の状態を先に更新してから保存。オフラインでも固まらない) ---------------- */
const cloudWrite = (p) => p.catch((e) => onCloudError(S.box.ownerUid, e));
// kind: 'put' | 'del' | 'batch'。ローカルは IndexedDB、クラウドは今のボックスへ投げっぱなし
async function persist(kind, col, a) {
  if (S.mode !== 'cloud') return db[kind](col, a);
  cloudWrite(S.cloud[kind](S.box.ownerUid, col, a));
  evalSync(true);
  return undefined;
}
function emitRecipes(changed, removed, trashChanged) {
  if (changed.length || removed.length) ev.emit('recipes', { changed, removed });
  if (trashChanged) ev.emit('trash');
}

async function putRecipe(raw) {
  const r = normalizeRecipe(raw);
  if (S.mode === 'cloud' && JSON.stringify(r).length > MAX_DOC) { toast(saveErrorText(err('too-large'))); return false; }
  const old = getRecipe(r.id) || getTrash(r.id);
  placeRecipe(r);
  emitRecipes(r.deletedAt ? [] : [r.id], r.deletedAt ? [r.id] : [], !!(r.deletedAt || (old && old.deletedAt)));
  try { await persist('put', 'recipes', r); } catch (e) { toast(saveErrorText(e)); return false; }
  return true;
}
async function delRecipe(id) {
  const inTrash = !!getTrash(id);
  S.recipes = S.recipes.filter((x) => x.id !== id);
  S.trash = S.trash.filter((x) => x.id !== id);
  emitRecipes([], [id], inTrash);
  try { await persist('del', 'recipes', id); } catch (e) { toast(saveErrorText(e)); return false; }
  return true;
}
// 献立('plan')・買い物リスト('shopping')。ops = [{ type:'put', d } | { type:'del', id }]
async function batchWrite(col, ops) {
  if (!ops.length) return true;
  const key = col === 'plan' ? 'plan' : 'shop';
  const normalize = col === 'plan' ? normalizeEntry : normalizeShopItem;
  const list = ops.map((op) => (op.type === 'del' ? { type: 'del', id: String(op.id) } : { type: 'put', d: normalize(op.d) }));
  let arr = S[key];
  list.forEach((op) => {
    arr = arr.filter((x) => x.id !== (op.type === 'del' ? op.id : op.d.id));
    if (op.type !== 'del') arr.push(op.d);
  });
  S[key] = arr;
  ev.emit(key);
  try { await persist('batch', col, list); } catch { toast('保存できませんでした'); return false; }
  return true;
}
async function saveSettings(next) {
  const n = normalizeSettings({ ...settingsData(), ...(next || {}) });
  applySettings(n);
  if (S.mode !== 'cloud') { prefs.set('settings', n); return true; }
  cloudWrite(S.cloud.putSettings(S.box.ownerUid, n));
  evalSync(true);
  return true;
}
const deleteForever = (ids) => Promise.all(ids.map(delRecipe)).then((rs) => rs.every(Boolean));
// 30日を過ぎたものは自動で完全に削除
function purgeTrash() {
  const old = S.trash.filter((r) => trashDaysLeft(r) <= 0).map((r) => r.id);
  if (old.length) deleteForever(old);
}
function finishLoad() {
  S.loaded = true;
  ev.emit('recipes', { changed: S.recipes.map((r) => r.id), removed: [] });
  ev.emit('trash');
  ev.emit('plan');
  ev.emit('shop');
  purgeTrash();
  ev.emit('loaded');
}

/* ---------------- この端末だけ(ログインしていない) ---------------- */
async function loadLocal() {
  S.mode = 'local';
  S.box = { ...LOCAL_BOX };
  S.boxes = [{ ...LOCAL_BOX }];
  S.subscribed = null;
  ev.emit('box', S.box);
  ev.emit('boxes', S.boxes);
  applySettings(normalizeSettings(prefs.get('settings', null)));
  try {
    const raw = await db.all('recipes');
    S.recipes = [];
    S.trash = [];
    raw.map(normalizeRecipe).forEach(placeRecipe);
    // 旧形式(category)のデータを新形式で保存し直す
    for (const r of raw) if (needsMigration(r)) await db.put('recipes', getRecipe(r.id) || getTrash(r.id));
    S.plan = (await db.all('plan')).map(normalizeEntry);
    S.shop = (await db.all('shopping')).map(normalizeShopItem);
  } catch {
    toast('このブラウザでは保存機能が使えません');
  }
  finishLoad();
  setSync('local');
}

/* ---------------- クラウド ---------------- */
const GATE_OFFLINE = 'インターネットにつながっていないようです。接続してから開き直すか、この端末だけで使ってください。';
function cloudLoadFailed() {
  setSync('error', '同期の仕組みを読み込めませんでした');
  if (prefs.get('localOnly', false)) loadLocal();
  else ev.emit('gate', { error: GATE_OFFLINE });
}
async function startCloud() {
  setSync('syncing');
  // 同期の仕組みを読み込めないとき(初回オフラインなど)は、ログイン画面で理由を伝える
  const timer = setTimeout(() => { if (!S.cloud) cloudLoadFailed(); }, 10000);
  try {
    const api = await cloud.init();
    clearTimeout(timer);
    if (api) attachCloud(api);
  } catch {
    clearTimeout(timer);
    cloudLoadFailed();
  }
}

// クラウド API を取り付ける(cloud.js の init() の戻り値か、動作確認用の偽クラウド)
function attachCloud(api) {
  unsubscribeBox();
  if (unsubBoxes) { unsubBoxes(); unsubBoxes = null; }
  if (unsubAuth) { unsubAuth(); unsubAuth = null; }
  S.cloud = api;
  unsubAuth = api.onAuth(onAuth);
}
function unsubscribeBox() { unsubBox.forEach((u) => u()); unsubBox = []; S.subscribed = null; }

function onAuth(user) {
  unsubscribeBox();
  if (unsubBoxes) { unsubBoxes(); unsubBoxes = null; }
  S.user = user;
  clearData();
  if (user) {
    S.mode = 'cloud';
    prefs.set('localOnly', false);
    S.fromCache = true;
    S.pending = false;
    S.joined = [];
    S.wantBox = prefs.get('box', null); // 前回開いていたボックス。一覧に現れたら1回だけ選ぶ
    S.boxes = [myBox()];
    S.box = { ...S.boxes[0], name: boxName(S.boxes[0]) };
    ev.emit('auth', user);
    ev.emit('box', S.box);
    setSync('syncing');
    migrateLocal(user);
    unsubBoxes = S.cloud.watchBoxes(user.uid, onBoxes, (e) => onCloudError(user.uid, e));
  } else {
    S.mode = 'local';
    // ログアウト直後はゲートの後ろにクラウドのボックス名が残らないよう、この端末だけの状態に戻しておく
    S.box = { ...LOCAL_BOX };
    S.boxes = [{ ...LOCAL_BOX }];
    ev.emit('box', S.box);
    ev.emit('boxes', S.boxes);
    ev.emit('auth', null);
    if (prefs.get('localOnly', false)) loadLocal();
    else ev.emit('gate', {});
  }
}

// この端末にだけ保存されていたレシピ・献立・買い物を、初回ログイン時に自分のボックスへ移す(1回だけ)
async function migrateLocal(user) {
  const key = 'migrated:' + user.uid;
  if (prefs.get(key, false)) return;
  let local = [];
  try { local = (await db.all('recipes')).map(normalizeRecipe); } catch { /* 端末側に保存がない */ }
  prefs.set(key, true);
  for (const col of ['plan', 'shopping']) {
    try {
      const docs = await db.all(col);
      if (docs.length) cloudWrite(S.cloud.batch(user.uid, col, docs.map((d) => ({ type: 'put', d }))));
    } catch { /* 端末側に保存がない */ }
  }
  if (!local.length) return;
  let ok = 0;
  for (const r of local) {
    if (JSON.stringify(r).length > MAX_DOC) continue; // 大きすぎる1件は飛ばす
    cloudWrite(S.cloud.put(user.uid, 'recipes', r));
    ok++;
  }
  evalSync(true);
  toast(`この端末のレシピ ${ok} 件をクラウドに移しました`);
}

/* ---------------- ボックス(自分のレシピ帳と、参加しているレシピ帳) ---------------- */
const myBox = () => ({ ownerUid: S.user.uid, ownerName: S.user.name, name: '', isMine: true });
// 名前:購読中なら設定の boxName → 覚えている名前 → 「◯◯のレシピ」→ 「マイボックス」
function boxName(b) {
  const fromSettings = b.ownerUid === S.subscribed ? settings.boxName : '';
  const known = prefs.get('boxNames', {})[b.ownerUid] || '';
  return fromSettings || known || (b.ownerName ? `${b.ownerName}のレシピ` : 'マイボックス');
}
function refreshBoxNames() {
  if (S.mode !== 'cloud' || !S.user) return;
  if (S.subscribed && settings.boxName) {
    const names = prefs.get('boxNames', {});
    if (names[S.subscribed] !== settings.boxName) { names[S.subscribed] = settings.boxName; prefs.set('boxNames', names); }
  }
  S.boxes.forEach((b) => { b.name = boxName(b); });
  const cur = S.boxes.find((b) => b.ownerUid === S.box.ownerUid);
  if (cur && cur.name !== S.box.name) { S.box = { ...cur }; ev.emit('box', S.box); }
}

function onBoxes(raw) {
  if (!S.user) return;
  const me = S.user.uid;
  S.joined = raw
    .filter((b) => b && b.ownerUid && b.ownerUid !== me)
    .map((b) => ({ ownerUid: String(b.ownerUid), ownerName: String(b.ownerName || ''), joinedAt: +b.joinedAt || 0 }));
  S.boxes = [myBox(), ...S.joined.map((b) => ({ ownerUid: b.ownerUid, ownerName: b.ownerName, name: '', isMine: false }))];
  const valid = (id) => !!id && S.boxes.some((b) => b.ownerUid === id);
  const want = valid(S.wantBox) ? S.wantBox : valid(S.subscribed) ? S.subscribed : me;
  if (valid(S.wantBox)) S.wantBox = null;
  if (want !== S.subscribed) selectBox(want);
  else refreshBoxNames();
  ev.emit('boxes', S.boxes);
}

// ボックスを切り替える:購読を張り直し、recipes/plan/shop/settings/trash/members を入れ替える
function selectBox(ownerUid) {
  const b = S.boxes.find((x) => x.ownerUid === ownerUid) || S.boxes[0];
  prefs.set('box', b.ownerUid);
  unsubscribeBox();
  clearData();
  S.subscribed = b.ownerUid;
  S.fromCache = true;
  S.pending = false;
  S.boxes.forEach((x) => { x.name = boxName(x); });
  S.box = { ...b };
  S.sync = { state: 'syncing', error: '' };
  ev.emit('box', S.box);
  ev.emit('sync', S.sync);
  const onErr = (e) => onCloudError(b.ownerUid, e);
  unsubBox = [
    S.cloud.watchRecipes(b.ownerUid, onRecipesSnap, onErr),
    S.cloud.watchCollection(b.ownerUid, 'plan', (ch) => onCollection('plan', ch), onErr),
    S.cloud.watchCollection(b.ownerUid, 'shopping', (ch) => onCollection('shopping', ch), onErr),
    S.cloud.watchCollection(b.ownerUid, 'members', onMembers, onErr),
    S.cloud.watchSettings(b.ownerUid, onSettingsSnap, onErr),
  ];
}

function onRecipesSnap({ changes, fromCache, pending }) {
  const changed = [], removed = [];
  let trashChanged = false;
  for (const c of changes) {
    const old = getRecipe(c.id) || getTrash(c.id);
    if (c.type === 'removed') {
      if (!old) continue;
      if (old.deletedAt) trashChanged = true; else removed.push(c.id);
      S.recipes = S.recipes.filter((x) => x.id !== c.id);
      S.trash = S.trash.filter((x) => x.id !== c.id);
      continue;
    }
    const r = normalizeRecipe({ ...c.data, id: c.id });
    if (needsMigration(c.data) && !pending) cloudWrite(S.cloud.put(S.box.ownerUid, 'recipes', r));
    if (!old || JSON.stringify(old) !== JSON.stringify(r)) {
      // ほかの端末での変更を反映(ゴミ箱に入れた・戻したも含む)
      const wasActive = !!getRecipe(r.id);
      placeRecipe(r);
      if (r.deletedAt) { if (wasActive) removed.push(r.id); trashChanged = true; }
      else { changed.push(r.id); if (old && old.deletedAt) trashChanged = true; }
    }
  }
  if (!S.loaded) finishLoad();
  else emitRecipes(changed, removed, trashChanged);
  S.fromCache = fromCache;
  S.pending = pending;
  if (S.sync.state === 'error' && !fromCache) S.sync.state = 'syncing';
  evalSync();
}

function onCollection(col, changes) {
  const key = col === 'plan' ? 'plan' : 'shop';
  const normalize = col === 'plan' ? normalizeEntry : normalizeShopItem;
  let arr = S[key];
  let changed = false;
  changes.forEach((c) => {
    if (c.type === 'removed') {
      if (arr.some((x) => x.id === c.id)) { arr = arr.filter((x) => x.id !== c.id); changed = true; }
      return;
    }
    const d = normalize({ ...c.data, id: c.id });
    const old = arr.find((x) => x.id === d.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(d)) {
      arr = arr.filter((x) => x.id !== d.id).concat(d);
      changed = true;
    }
  });
  S[key] = arr;
  if (changed) ev.emit(key);
}

function onMembers(changes) {
  let arr = S.members;
  changes.forEach((c) => {
    arr = arr.filter((m) => m.uid !== c.id);
    if (c.type === 'removed') return;
    const d = c.data || {};
    arr.push({ uid: c.id, code: String(d.code || ''), name: String(d.name || ''), photo: String(d.photo || ''), joinedAt: +d.joinedAt || 0 });
  });
  S.members = arr.sort((a, b) => a.joinedAt - b.joinedAt);
  ev.emit('members', S.members);
}

// ほかの端末で選択肢を変えたとき。まだクラウドに無ければ、この端末の設定を送る(自分のボックスだけ)
function onSettingsSnap(data) {
  if (data) return applySettings(normalizeSettings(data));
  if (!S.box.isMine) return;
  const local = normalizeSettings(prefs.get('settings', null));
  if (JSON.stringify(local) === JSON.stringify(normalizeSettings(null))) return;
  applySettings(local);
  cloudWrite(S.cloud.putSettings(S.box.ownerUid, local));
}

function onCloudError(ownerUid, e) {
  const code = (e && e.code) || '';
  if (code === 'permission-denied' && S.user && ownerUid && ownerUid !== S.user.uid) return dropBox(ownerUid);
  setSync('error', code === 'permission-denied'
    ? '保存先への権限がありません(セキュリティルールを確認してください)'
    : `しばらくしてからもう一度試してください(${code || 'unknown'})`);
}

// 外されたボックス:一覧から消して知らせる
function dropBox(ownerUid) {
  const b = S.boxes.find((x) => x.ownerUid === ownerUid);
  if (!b) return;
  const name = b.name || 'このボックス';
  S.joined = S.joined.filter((x) => x.ownerUid !== ownerUid);
  S.boxes = S.boxes.filter((x) => x.ownerUid !== ownerUid);
  if (S.subscribed === ownerUid) selectBox(S.user.uid);
  ev.emit('boxes', S.boxes);
  toast(`「${name}」にアクセスできなくなったため、一覧から外しました`);
  S.cloud.setBoxes(S.user.uid, S.joined).catch(() => {});
}

function genCode() {
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return [...a].map((n) => INVITE_CHARS[n % INVITE_CHARS.length]).join('');
}
function needCloud() {
  if (!S.cloud || !S.user) throw err('not-signed-in');
}
const NET_TEXT = 'インターネットにつながっていないようです。接続を確認してください';
const JOIN_ERRORS = {
  'not-signed-in': 'ログインすると使えます', 'bad-code': '招待コードは6文字です', 'not-found': 'この招待コードは見つかりません',
  expired: '招待コードの有効期限が切れています(7日間)', own: '自分のボックスには参加できません',
  'permission-denied': '招待コードが無効か、期限切れです', network: NET_TEXT, unavailable: NET_TEXT,
};

/* ---------------- 公開 API ---------------- */
export const store = {
  on: ev.on, off: ev.off, emit: ev.emit,
  prefs,
  install: null, // beforeinstallprompt のイベント(app.js が入れる)。'install' イベントで知らせる
  get hasCloud() { return cloud.hasCloud; },
  get mode() { return S.mode; },
  get user() { return S.user; },
  get loaded() { return S.loaded; },
  get box() { return S.box; },
  get boxes() { return S.boxes; },
  get members() { return S.members; },
  get sync() { return S.sync; },
  settings,

  recipes: {
    get list() { return S.recipes; },
    get: getRecipe,
    put: putRecipe,
    del: delRecipe,
    async trash(id) { const r = getRecipe(id); return r ? putRecipe({ ...r, deletedAt: Date.now() }) : false; },
    async restore(id) { const r = getTrash(id); return r ? putRecipe({ ...r, deletedAt: null }) : false; },
  },
  trash: {
    get list() { return S.trash; },
    get: getTrash,
    daysLeft: trashDaysLeft,
    deleteForever,
    purge: purgeTrash,
  },
  plan: {
    get list() { return S.plan; },
    get: (id) => S.plan.find((e) => e.id === id),
    batch: (ops) => batchWrite('plan', ops),
    put: (d) => batchWrite('plan', [{ type: 'put', d }]),
    del: (id) => batchWrite('plan', [{ type: 'del', id }]),
  },
  shop: {
    get list() { return S.shop; },
    get: (id) => S.shop.find((s) => s.id === id),
    batch: (ops) => batchWrite('shopping', ops),
    put: (d) => batchWrite('shopping', [{ type: 'put', d }]),
    del: (id) => batchWrite('shopping', [{ type: 'del', id }]),
  },

  // 起動。非同期に始まるので、呼んだ直後に on() を登録しても間に合う
  init() {
    window.addEventListener('online', () => evalSync());
    window.addEventListener('offline', () => evalSync());
    setTimeout(() => (cloud.hasCloud ? startCloud() : loadLocal()), 0);
  },
  // 動作確認用:クラウド API を差し替える(cloud.js の init() と同じ形のオブジェクト)
  attachCloud,
  // 「ログインせずに使う」
  useLocal() {
    prefs.set('localOnly', true);
    loadLocal();
  },
  async signIn() {
    const api = await new Promise((res, rej) => {
      if (S.cloud) return res(S.cloud);
      const start = Date.now();
      const iv = setInterval(() => {
        if (S.cloud) { clearInterval(iv); res(S.cloud); }
        else if (Date.now() - start > 10000) { clearInterval(iv); rej(err('load-failed')); }
      }, 100);
    });
    await api.signIn();
  },
  async signOut() { needCloud(); await S.cloud.signOut(); },
  signInErrorText(e) {
    const code = (e && (e.code || e.message)) || '';
    if (code === 'load-failed' || code === 'auth/network-request-failed') return 'インターネットにつながっていないようです。接続を確認してください。';
    if (code === 'auth/unauthorized-domain') return 'このURLが Firebase の「承認済みドメイン」に登録されていません。';
    if (code === 'auth/operation-not-allowed') return 'Firebase で Google ログインが有効になっていません。';
    return `ログインできませんでした(${code})`;
  },
  // 同期状態の文 { title, sub }
  syncText() {
    const [title, sub] = SYNC_TEXT[S.sync.state] || SYNC_TEXT.local;
    return { title, sub: S.sync.error || sub };
  },

  /* ---- ボックス(共有) ---- */
  switchBox(ownerUid) {
    if (S.mode !== 'cloud' || ownerUid === S.subscribed || !S.boxes.some((b) => b.ownerUid === ownerUid)) return false;
    S.wantBox = null;
    selectBox(ownerUid);
    ev.emit('boxes', S.boxes);
    return true;
  },
  // 招待コードを発行 → { code, ownerUid, ownerName, createdAt, expiresAt }
  async createInvite() {
    needCloud();
    const code = genCode();
    const data = { ownerUid: S.user.uid, ownerName: S.user.name, createdAt: Date.now(), expiresAt: Date.now() + INVITE_DAYS * 864e5 };
    await withTimeout(S.cloud.createInvite(code, data));
    return { code, ...data };
  },
  listInvites() { needCloud(); return withTimeout(S.cloud.listInvites(S.user.uid)); },
  deleteInvite(code) { needCloud(); return withTimeout(S.cloud.deleteInvite(code)); },
  // コードで参加 → 参加したボックス(切り替え済み)。失敗は joinErrorText(e) で文にする
  async joinBox(raw) {
    needCloud();
    const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) throw err('bad-code');
    const inv = await withTimeout(S.cloud.getInvite(code));
    if (!inv) throw err('not-found');
    if (!(+inv.expiresAt > Date.now())) throw err('expired');
    if (inv.ownerUid === S.user.uid) throw err('own');
    if (!S.joined.some((b) => b.ownerUid === inv.ownerUid)) {
      await withTimeout(S.cloud.addMember(inv.ownerUid, S.user.uid, { code, name: S.user.name, photo: S.user.photo, joinedAt: Date.now() }));
      S.joined = [...S.joined, { ownerUid: String(inv.ownerUid), ownerName: String(inv.ownerName || ''), joinedAt: Date.now() }];
      await withTimeout(S.cloud.setBoxes(S.user.uid, S.joined));
      onBoxes(S.joined);
    }
    selectBox(inv.ownerUid);
    ev.emit('boxes', S.boxes);
    return S.box;
  },
  joinErrorText(e) {
    const code = (e && e.code) || '';
    return JOIN_ERRORS[code] || `参加できませんでした(${code || 'unknown'})`;
  },
  // 参加しているボックスから退出する
  async leaveBox(ownerUid) {
    needCloud();
    if (ownerUid === S.user.uid) throw err('own');
    await withTimeout(S.cloud.removeMember(ownerUid, S.user.uid));
    S.joined = S.joined.filter((b) => b.ownerUid !== ownerUid);
    await withTimeout(S.cloud.setBoxes(S.user.uid, S.joined));
    onBoxes(S.joined);
    if (S.subscribed === ownerUid) selectBox(S.user.uid);
    ev.emit('boxes', S.boxes);
  },
  // 自分のボックスからメンバーを外す(オーナーだけ)
  async removeMember(memberUid) {
    needCloud();
    await withTimeout(S.cloud.removeMember(S.user.uid, memberUid));
  },
};
