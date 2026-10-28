# MODULES.md — 基盤が公開する API(store / ui / lib)と機能モジュールの契約

最終更新:2026-10-28(基盤の実装と一致させてある。変えたら必ずここも直す)

機能モジュールは **`index.html`・`css/base.css`・`js/app.js`・`js/store.js`・`js/cloud.js`・`js/ui.js`・`js/lib/*` を編集しない**。足りないものは自分のモジュール内で補うか、結合担当への申し送りに書く。

```js
// 機能モジュールの先頭はだいたいこうなる
import { store, MEALS } from './store.js';
import * as ui from './ui.js';
import { el, lines, fmtDay } from './lib/text.js';
import { ingredientRows, buildShopping } from './lib/ingredients.js';
```

---

## 0. 全体像

```
index.html ─ firebase-config.js(window.RB2_FIREBASE_CONFIG / RB2_YOUTUBE_API_KEY だけが window のグローバル)
   └─ js/app.js(起動)
        ├─ store.init()                      … データ層(IndexedDB 'recipe-box-2' ⇄ Firestore)
        ├─ 各機能モジュールの init() を順に   … timers → pip → cook → recipe-detail → recipe-form → recipes → today → plan → shop → fridge → settings → sharing
        ├─ 上部バー(ボックス名 ▾ → sharing.openBoxMenu / ≡ → settings.openSettings)・タブバーのバッジ・追加ボタン(→ recipe-form.openForm)
        ├─ ゲート(store の 'gate' / 'auth' イベント)・起動画面(sessionStorage 'rb2:intro')
        ├─ ui.initTabs(前回のタブ)
        └─ 共有メニューから開かれたとき:読み込み後に store.emit('share', preset)(app.js 自身が openForm(null, preset) を呼ぶ)
```

### index.html の mount 先(機能モジュールはここに描く)

| セレクタ | 誰が使う | 中身 |
|---|---|---|
| `#view-recipes` | recipes.js | ホーム。先頭に `#today` がある(today.js が描く)。その後ろに検索・絞り込み・カードを**自分で追加**する |
| `#today` | today.js | 今日の献立 |
| `#view-plan` | plan.js | 献立タブ(最初は空・hidden) |
| `#view-shop` | shop.js | 買い物タブ(最初は空・hidden) |
| `#overlays` | ui.page / ui.sheet | ページ・シートはここに作られる(直接触らない) |
| `#pip` | pip.js | 小窓の器(`position:fixed; z-index:70; hidden`)。中身を作って `hidden=false` にする |
| `#timers` | timers.js | タイマーの器(画面下・タブバーの上に固定。`#timers > *` は pointer-events:auto) |
| `#toast` | ui.toast | 直接触らない |
| `#fab` `#tabbar` `#topbar` `#gate` `#intro` | app.js | 直接触らない(`#shopCount` のバッジも app.js が更新する) |

タブの切り替えは `ui.goTab()` か `<button data-goto="plan">`(どこに置いても動く)。

### z-index の層

上部バー 30 / タブバー・追加ボタン 40 / ページ・シート 50〜(開いた順に上) / 小窓 70 / タイマー 80 / メニュー 85 / ゲート 90 / 起動画面 95 / 通知 99

### 端末内の保存の名前(基盤が使っているキー。かぶらないように)

- `localStorage`:`rb2:tab` `rb2:localOnly` `rb2:box` `rb2:boxNames` `rb2:settings` `rb2:migrated:<uid>`
- 機能モジュールは `store.prefs.get/set('自分のキー')`(自動で `rb2:` が付く)。例:`rb2:sort` `rb2:fav` `rb2:time` `rb2:planDays` `rb2:lastMeal` `rb2:fridge` `rb2:fridgeSeasonOk` `rb2:pipPos` `rb2:pipSize`
- `sessionStorage`:`rb2:intro`
- IndexedDB:`recipe-box-2`(stores `recipes` `plan` `shopping`)。store.js 以外は触らない
- Service Worker のキャッシュ名:`rb2-v2`(sw.js の `CACHE`。SHELL のファイルの中身を変えたら番号を上げる。ファイルを足したら SHELL にも列挙する)

---

## 1. store(`js/store.js`)

```js
import { store, prefs, MEALS, MEAL_ORDER, MEAL_SHORT, COURSE_MAP, DEFAULT_SETTINGS, TRASH_DAYS, MAX_DOC,
         normalizeRecipe, normalizeSettings, normalizeEntry, normalizeShopItem, needsMigration } from './store.js';
```

### 1.1 状態(読むだけ。直接書き換えない)

| プロパティ | 型 | 内容 |
|---|---|---|
| `store.recipes.list` | `Recipe[]` | 有効なレシピ(ゴミ箱は含まない)。並び順は保証しない(自分で sort する) |
| `store.trash.list` | `Recipe[]` | ゴミ箱(`deletedAt` あり) |
| `store.plan.list` | `Entry[]` | 献立の1品(クラウドでは直近60日より前は無い) |
| `store.shop.list` | `ShopItem[]` | 買い物リスト |
| `store.settings` | `Settings` | `{ genres, courses, staples, meals, boxName }`。**同じオブジェクトが更新され続ける**(参照を持っていてよい)。`store.settings.save(next)` で保存 |
| `store.box` | `{ ownerUid, ownerName, name, isMine }` | 今のボックス。ログインしていないときは `{ ownerUid:null, name:'マイボックス', isMine:true }` |
| `store.boxes` | `Box[]` | 切り替えられるボックス(先頭が自分)。ローカルでは1つ |
| `store.members` | `{ uid, code, name, photo, joinedAt }[]` | 今のボックスのメンバー(オーナー自身は含まない)。参加日順 |
| `store.user` | `{ uid, name, email, photo } \| null` | ログイン中のユーザー |
| `store.mode` | `'local' \| 'cloud'` | 保存先 |
| `store.hasCloud` | `boolean` | firebase-config.js に設定があるか |
| `store.loaded` | `boolean` | 最初の読み込みが終わったか。**false の間は「0件」と見せない**(ボックス切り替え中も false になる) |
| `store.sync` | `{ state, error }` | `state`:`'local' \| 'syncing' \| 'synced' \| 'offline' \| 'error'`。書き込むと `syncing` になり、レシピの購読(`includeMetadataChanges`)で保留中の書き込みが無くなったと分かったときに `synced` へ戻る(v1 と同じ。献立・買い物・設定だけを書いたあとは、次にレシピの snapshot が来るまで `syncing` のまま) |
| `store.install` | `BeforeInstallPromptEvent \| null` | 「ホーム画面に追加」に使う(app.js が入れる。'install' イベントで変わる) |
| `store.prefs` | | `get(key, default)` / `set(key, value)` / `del(key)`。`rb2:` 接頭辞を自動で付ける(JSON) |

データの形(すべて正規化済み。`lib/model.js` の normalize* と同じ):

```js
Recipe   { id, name, genre, course, time:number|null, servings, tags:string[], photo:dataURL|null, videoUrl,
           ingredients, steps, memo, favorite, rating:0-5, cooked:[{ id, date:'YYYY-MM-DD', note, photo }],
           deletedAt:number|null, createdAt, updatedAt }
Entry    { id, date:'YYYY-MM-DD', meal:'breakfast'|'lunch'|'dinner', recipeId, servings, createdAt }
ShopItem { id, key, name, amount, recipes:string[], group:'food'|'season'|'manual', source:'plan'|'manual', checked, createdAt }
Settings { genres:string[], courses:string[], staples:string[]|null, meals:string[], boxName:string }
Box      { ownerUid, ownerName, name, isMine }
```

### 1.2 イベント

`const off = store.on(event, fn)` で購読(戻り値は解除関数)。`store.off(event, fn)`、`store.emit(event, data)` もある。

| イベント | 引数 | いつ |
|---|---|---|
| `'recipes'` | `{ changed:string[], removed:string[] }` | 有効なレシピが変わった(追加・編集・ゴミ箱から戻した = changed、削除・ゴミ箱へ = removed)。読み込み直後は全件が changed。**詳細ページは自分の id が removed に入っていたら閉じる、changed なら描き直す** |
| `'trash'` | なし | ゴミ箱が変わった |
| `'plan'` | なし | 献立が変わった(ほかの端末・他のメンバーの変更も含む) |
| `'shop'` | なし | 買い物リストが変わった |
| `'settings'` | `settings` | 選択肢・食事・ボックス名が変わった |
| `'box'` | `box` | ボックスが切り替わった、または名前が変わった。**切り替え時は recipes/plan/shop/settings/trash/members が空になってから各イベントが順に来る**(全画面を描き直す) |
| `'boxes'` | `boxes` | ボックスの一覧が変わった |
| `'members'` | `members` | メンバーが変わった |
| `'sync'` | `sync` | 同期状態が変わった |
| `'auth'` | `user \| null` | ログイン・ログアウト |
| `'gate'` | `{ error? }` | ゲート(ログイン画面)を出すべきとき(app.js が処理する) |
| `'loaded'` | なし | 最初の読み込みが終わった(ボックス切り替え後にも来る) |
| `'share'` | `preset` | 共有メニューから開かれたとき(app.js が `openForm(null, preset)` を呼ぶ。**機能モジュールは購読しない**) |
| `'visible'` | なし | アプリに戻ってきたとき(visibilitychange)。「今日」を描き直すなどに |
| `'install'` | `event \| null` | `store.install` が変わった |

購読は `init()` の中で登録すればよい(`store.init()` は非同期に始まるので間に合う)。描く側は **`store.loaded` を見て**から0件の案内を出す。

```js
export function init() {
  store.on('recipes', render);
  store.on('box', render);        // 切り替え直後は list が空・loaded=false
  store.on('loaded', render);
  ui.onTab((tab) => { if (tab === 'plan') render(); });
}
```

### 1.3 書き込み(画面の状態を先に更新 → 保存。オフラインでも固まらない)

すべて `Promise<boolean>`。失敗(写真が大きすぎる・端末の容量不足)は **store が toast を出して false** を返すので、呼ぶ側は toast を重ねない。成功時は該当イベントが先に飛んでいる(戻りを待たずに描いてよい)。クラウドでは書き込みは投げっぱなし(即 true)。

| 関数 | 内容 |
|---|---|
| `store.recipes.put(recipe)` | 正規化して保存(新規も更新も)。id が無ければ付く。`deletedAt` が入っていればゴミ箱へ |
| `store.recipes.del(id)` | 完全に削除(普段は使わない。ゴミ箱の「完全に削除」は `store.trash.deleteForever`) |
| `store.recipes.trash(id)` | ゴミ箱へ(deletedAt を付けて put)。無ければ false |
| `store.recipes.restore(id)` | ゴミ箱から戻す |
| `store.recipes.get(id)` | 有効なレシピを1件(無ければ undefined) |
| `store.trash.get(id)` / `store.trash.daysLeft(r)` | ゴミ箱の1件 / 完全に削除されるまでの日数(0〜30) |
| `store.trash.deleteForever(ids)` | 複数を完全に削除 |
| `store.trash.purge()` | 30日を過ぎたものを完全に削除(読み込み時に自動で呼ばれる) |
| `store.plan.batch(ops)` | `ops = [{ type:'put', d:Entry } \| { type:'del', id }]`。まとめて保存(クラウドは 450件ずつ) |
| `store.plan.put(entry)` / `store.plan.del(id)` / `store.plan.get(id)` | 1件 |
| `store.shop.batch(ops)` / `store.shop.put(item)` / `store.shop.del(id)` / `store.shop.get(id)` | 買い物リスト(ops の形は plan と同じ) |
| `store.settings.save(next)` | `next` は部分でよい(`{ genres:[...] }`)。正規化して保存し、'settings' を飛ばす。ボックス名は `save({ boxName })` |

```js
// 例:★を付ける
const r = store.recipes.get(id);
r.rating = r.rating === v ? 0 : v;
renderStars(r, true);                 // 先に描く
await store.recipes.put(r);           // 失敗なら store が toast を出す
// 例:ゴミ箱へ + 元に戻す
if (await store.recipes.trash(id)) ui.toast(`「${name}」をゴミ箱に移動しました`, { label: '元に戻す', run: () => store.recipes.restore(id) });
// 例:献立に1品
await store.plan.put({ id: uid(), date, meal, recipeId, servings, createdAt: Date.now() });
// 例:買い物リストを作り直す(献立から作った未購入だけ入れ替える)
await store.shop.batch([...dels.map((s) => ({ type: 'del', id: s.id })), ...items.map((d) => ({ type: 'put', d }))]);
```

写真込みの1件は 950,000 文字まで(`MAX_DOC`)。`compressImage()` の既定値(450KB 目安)なら収まる。

### 1.4 ログイン・同期・ボックス

| 関数 | 内容 |
|---|---|
| `await store.signIn()` | Google でログイン(popup → redirect)。失敗は throw → `store.signInErrorText(e)` で文に |
| `await store.signOut()` | ログアウト(ゲートが出る)。データは空になり、`store.box` は「マイボックス」に戻る('box' → 'auth' の順にイベント) |
| `store.useLocal()` | 「ログインせずに使う」(app.js のゲートが呼ぶ) |
| `store.syncText()` | `{ title, sub }` 同期状態の文(設定画面の「同期」に使う)。点の色は `.sync-dot[data-state=…]` |
| `store.switchBox(ownerUid)` | ボックスを切り替える(ログイン中・一覧にあるときだけ true)。購読が張り直され、'box' → 各データのイベントが来る |
| `await store.createInvite()` | 招待コードを発行 → `{ code, ownerUid, ownerName, createdAt, expiresAt }`(6文字・7日) |
| `await store.listInvites()` / `await store.deleteInvite(code)` | 自分が発行した招待の一覧 `[{ code, ownerUid, ownerName, createdAt, expiresAt }]` / 取り消し |
| `await store.joinBox(code)` | コードで参加(大文字小文字・空白・ハイフンは無視)。参加したボックスに切り替わり `box` を返す。失敗は throw → `store.joinErrorText(e)` |
| `await store.leaveBox(ownerUid)` | 参加しているボックスから退出(自分のボックスへ戻る) |
| `await store.removeMember(uid)` | 自分のボックスからメンバーを外す(オーナーだけ) |

- ログインしていないときはこれらは `code:'not-signed-in'` で throw する → 共有の画面は「ログインすると使えます」
- 外されたメンバーのアプリは permission-denied を受け取ると、そのボックスを一覧から消して toast で知らせ、自分のボックスへ戻る(store が自動でやる)
- 初回ログイン時に、この端末だけに保存していたレシピ・献立・買い物はクラウドへ移される(store が自動でやる。toast あり)

### 1.5 動作確認用:偽クラウド

確認用ブラウザでは Google ログインできないので、クラウド経路は `store.attachCloud(api)` で偽の API を差し込んで確認する(コンソールから `const { store } = await import('./js/store.js')`)。`api` は `cloud.js` の `init()` が返すオブジェクトと同じ形:

```
uid(), onAuth(cb) → unsub, signIn(), signOut(),
watchRecipes(ownerUid, onData({changes:[{type,id,data}], fromCache, pending}), onError) → unsub,
watchCollection(ownerUid, 'plan'|'shopping'|'members', onData([{type,id,data}]), onError) → unsub,
watchSettings(ownerUid, onData(data|null), onError) → unsub,  watchBoxes(uid, onData(boxes[], fromCache), onError) → unsub,
put(ownerUid, col, d), del(ownerUid, col, id), batch(ownerUid, col, ops), putSettings(ownerUid, data), setBoxes(uid, boxes),
createInvite(code, data), getInvite(code), deleteInvite(code), listInvites(uid), addMember(ownerUid, memberUid, data), removeMember(ownerUid, memberUid)
```

---

## 2. ui(`js/ui.js`)

```js
import * as ui from './ui.js';   // または import { page, sheet, open, close, toast, menu, flip, ICON } from './ui.js';
```

### 2.1 ページとシート

| 関数 | 内容 |
|---|---|
| `ui.page({ id, title, build(body, ov), onClose?, onBack?, head = true })` | 全画面ページ(下からスライド)。`head:false` で見出し行なし(自分で `‹` を置く。`data-close` 属性を付ければ閉じる)。戻り値 `ov` に `body` `panel` `titleEl` `tools`(見出し右側の置き場)`setTitle(text)` が付く |
| `ui.sheet({ id, title, eyebrow?, build(body, ov), onClose?, onBack?, closeBtn = true })` | 下から出る小さめの画面(スマホは画面下に張り付く、PC は中央のカード)。外側を押すと閉じる。`ov` に `body` `panel` `titleEl` `eyebrowEl` `setTitle(text, eyebrow?)` |
| `ui.open(ov, origin?)` | 開く(履歴を1つ積む)。`origin` は押したボタン(シートがそこから広がる) |
| `ui.close(ov)` | 閉じる(積んだ履歴も戻す)。上に乗っている画面も一緒に閉じる |
| `ui.closeNow(ov)` | 履歴に触れずに閉じる(普段は使わない) |
| `ui.isOpen(ov)` / `ui.topOverlay()` | 開いているか / いちばん上の画面 |
| `ui.pushStep(ov, onBack)` | 画面の中の段階(設定の一覧 → 各項目)を履歴に積む。「戻る」で `onBack()` が呼ばれる(画面は閉じない)。`ui.close(ov)` は積んだ分もまとめて戻す |
| `ui.back()` | `history.back()`(「‹ 設定」のようなボタンに) |

`build` は作成時に1回だけ呼ばれる(静的な骨組みを作る)。開くたびに中身を更新するのは自分の `openXxx()` でやる。`onBack()` が true を返すと「戻る」でも閉じない(自分で処理したとき)。`onClose()` は閉じたときに呼ばれる(Wake Lock の解放など)。Esc と「戻る」は ui が面倒を見る。

```js
let ov;
export function init() {
  ov = ui.sheet({ id: 'slot', title: '', eyebrow: '献立に追加', build(body) {
    body.innerHTML = '<h3 class="sec-h">いつ</h3><div class="chips" id="slotDays"></div> …';
  } });
}
export function openSlotPicker(recipeId, servings, origin) {
  ov.setTitle(store.recipes.get(recipeId).name);
  render();
  ui.open(ov, origin);
}
// 設定の一覧 → 各項目
function goPage(name) { showPage(name, 'forward'); ui.pushStep(settingsOv, () => showPage('main', 'back')); }
```

ページの DOM:`div.overlay.ov-page > section.page > (header.page-head > button.back-btn[data-close] + h2.page-title + div.page-tools) + div.page-body`
シートの DOM:`div.overlay.ov-sheet > section.sheet > (header.sheet-head > div.head-text(p.eyebrow + h2.sheet-title) + button.icon-btn[data-close]) + div.sheet-body`(`.sheet-body` は `display:grid; gap:16px`)

詳細ページのように下に固定のアクションバーを置く場合は、`.page-body` の中に `position: sticky; bottom: 0` の要素を置く(ページは `.overlay` がスクロールする)。

### 2.2 通知・メニュー・動き

| 関数 | 内容 |
|---|---|
| `ui.toast(msg, { label, run }?)` | 通知(2.2秒)。action を渡すとボタン付き(5秒)。`run()` は押したときに |
| `ui.menu(anchor, items, { align? })` | anchor の近くに出るメニュー。`items`:`{ label, sub?, icon?(SVG文字列), selected?, danger?, disabled?, onSelect }` / `{ header:'…' }` / `{ sep:true }`。外側・Esc・「戻る」で閉じる。同じ anchor でもう一度呼ぶと閉じるだけ(null を返す)。戻り値 `{ el, close }` |
| `ui.closeMenu()` | 開いているメニューを閉じる |
| `ui.flip(container, mutate, { duration=560, enter=true, stagger=45 }?)` | FLIP。`mutate()` の中で子要素の並び替え・hidden の切り替えをすると、残った子は移動で、現れた子はふわっと出る。**同じノードを使い回すこと**(v1 の cardNodes 方式) |
| `ui.shift(nodes, change)` | `change()` で高さが変わるとき、その下の要素 `nodes` を移動で追従させる(v1 の slideBelow) |
| `ui.setFab(on)` | 追加ボタンを出す/しまう(レシピタブ以外では CSS が自動でしまう) |
| `ui.ICON` | 共通 SVG 文字列:`play heart star timer link chef calendar check close pause resume plus back chevron down search trash edit share person fridge filter` |
| `ui.iconBtn(cls, iconName, label?)` | アイコン付き `<button type="button">` |

### 2.3 タブ

| 関数 | 内容 |
|---|---|
| `ui.getTab()` | `'recipes' \| 'plan' \| 'shop'` |
| `ui.onTab(fn)` | `fn(tab, prev)`。切り替わったあと(起動時の復元でも1回)。戻り値は解除関数 |
| `ui.goTab(tab)` | 切り替える(献立・買い物から「戻る」でレシピへ、は ui がやる) |

---

## 3. lib

状態に依存しない関数。レシピの一覧が要るものは引数で受け取る。

### `lib/text.js`
`norm(s)`(全角/半角・大文字/小文字・カタカナ→ひらがな)、`uid()`、`lines(s)`(改行で分けて trim・空行除去)、`todayStr()`、`dayFromToday(n)`、`fmtDay('2026-10-28')`→`'10/28(火)'`、`relDay(date)`→`'今日'|'明日'|''`、`fmtDate(date)`→`'10月28日'`(今年以外は年付き)、`daysAgo(date)`、`toSec('1:23')`→83、`fmtClock(83)`→`'1:23'`、`clamp(v, lo, hi)`、`WEEKDAYS`、`el(tag, cls?, text?)`、`replay(node, cls)`(アニメーション用クラスを付け直す)、`linkify(text)`(URL をリンクにした Fragment)、`emitter()`

### `lib/ingredients.js`
- 材料の1行:`parseIngredient(line)`→`{ name, amount }`または`{ header:true, name }`、`scaleAmount(amount, k)`(量の数字を k 倍。`'大さじ1と1/2'`×2→`'大さじ3'`)、`fmtNum(x)`、`ingredientRows(recipe, k)`→`[{ header, name } | { name, amount, scaled, changed }]`、`AMOUNT_WORDS` `ING_RE`
- 手順:`parseStep(line)`→`{ t:秒|null, text }`、`findDurations(text)`→`[{ sec, label }]`
- 買い物:`buildShopping(entries, getRecipe)`→`[{ key, name, group:'food'|'season', amount, recipes:[料理名] }]`(**第2引数に `store.recipes.get` を渡す**)、`parseAmount(amount, k)`、`fmtAmount(units, texts)`、`ingKey(name)`(たまご/卵 → 同じキー)、`stripNote(name)`、`isSeasoning(name, header)`、`SEASONINGS` `SKIP_ITEMS` `SEASON_HEADER` `SYNONYMS`
- 食材から探す:`recipeNeeds(recipe)`→`[{ key, name, amount, season }]`、`knownIngredients(recipes)`→`[{ key, name, season, count }]`、`autoStaples(recipes)`、`effectiveStaples(settings, recipes)`、`searchByFridge(recipes, items, seasonOk)`→`[{ r, used, missing }]`(すぐ作れる→足りないものが少ない順)、`keyMatches(recipeKey, haveKey)`

### `lib/video.js`
`videoInfo(url)`→`{ type:'youtube', id, url, thumb, start }`|`{ type:'link', url, label }`|null、`parseT('1m30s')`、`fetchVideoTitle(url)`(oEmbed)、`fetchYouTubeDetails(id)`→`{ title, description }`|null(API キーがあるときだけ)、`descriptionToRecipe(desc)`→`{ servings, ingredients[], steps[] }`|null、`DESC_ING` `DESC_STEP` `DESC_STOP` `DESC_SKIP_STEP`

YouTube の埋め込みは `https://www.youtube.com/embed/{id}?autoplay=1&playsinline=1&rel=0&enablejsapi=1&origin=…&start=…`(`youtube-nocookie` は使わない)。

### `lib/image.js`
`compressImage(file, max=1400, quality=.84, limit=450000)`→data URL、`drawImage(file, max, quality)`、`makeImg(src, cls?)`(読み込み後に `.loaded`)、`heroImage(recipe, cls?)`(写真 → YouTube サムネイル(`.yt`)→ null)

### `lib/search.js`
`haystack(r)`、`matches(r, { query, genre:'all', course:'all', fav, time })`、`allTags(recipes)`→`[[tag, n]]`、`suggestions(q, recipes)`→`[{ tag, n }]`(`#` 始まり)か`[{ r, score }]`(最大6件)、`highlight(name, q)`→Fragment(`<mark>`)、`SORTS`(`new rating cooked stale time name` の比較関数)、`SORT_OPTS` `TIME_OPTS`、`lastCooked(r)`

### `lib/model.js`(store.js からも再 export)
`normalizeRecipe` `normalizeSettings` `normalizeEntry` `normalizeShopItem` `needsMigration` と定数 `DEFAULT_SETTINGS` `MEALS`(`[{ id, label:'朝', long:'朝ごはん' }…]`)`MEAL_ORDER` `MEAL_SHORT` `COURSE_MAP` `TRASH_DAYS` `MAX_DOC` `INVITE_CHARS` `INVITE_DAYS`

### `lib/idb.js`
`openDb({ name, version, stores, onBlocked, onVersionChange })`(store.js 専用)

---

## 4. css/base.css の共通部品(機能の css はこれを前提に、足りないものだけ足す)

色は必ずトークン(`--bg --surface --sunken --ink --ink-2 --ink-3 --line --fill --brand --action --action-tint --selected-bg --selected-fg --success(-tint) --attention(-ink/-tint) --danger(-tint) --favorite --shadow-float --ease --sheet --spring --r-page --r-card --r-input`)。動きは transform と opacity だけ。

| クラス | 用途 |
|---|---|
| `.btn` `.btn.primary` `.btn.ghost` `.btn.danger` `.btn.danger.confirm` `.btn.small` `.btn.wide` `.btn.pop` | ボタン(操作色は primary だけ) |
| `.link` `.link.small` | 文字だけのボタン(操作色) |
| `.icon-btn`(34px 丸)`.round-btn`(44px 丸)`.back-btn`(‹) | 丸いボタン |
| `.chips`(横スクロールの行)`.chip` `.chip.active`(インク反転)`.chip .n`(件数) | チップ |
| `.pill` | ジャンル・時間のピル |
| `.segmented` `.segmented.wide` + `button.active` | 2〜3択 |
| `label.switch-row > span + input[type=checkbox] + span.switch` | スイッチ |
| `.stepper > button + span + button` | 人数のステッパー |
| `.field > label + input/textarea`、`.field.shake`、`.field-row`(2列)、`.suffix > input + span`、`.hint`、`.lbl-row > .lbl + .link.small`、`.filled-flash` | 入力(項目間 24px・ラベル 13px/600・入力 16px) |
| `form.add-row > input + button.btn.small` | 1行追加 |
| `ul.list > li`(`.grow` で伸びる) | 行の一覧(--sunken の面 + 1px の線) |
| `ul.nav-list > li > button > .nl-text(.nl-title + .nl-sub) + .nl-value + svg.nl-chev` | 設定の一覧行 |
| `ul.edit-chips > li > span + button` | ✕ 付きチップ |
| `.sec`(gap 12 の縦並び)`.sec-h`(小見出し)`.sec-h-row` `.eyebrow` | 見出し |
| `.avatar` `.sync-dot[data-state]` `.badge` | アカウント・同期の点・バッジ |
| `.empty > .empty-icon + h2 + p + .btn` | 0件の案内 |
| `.menu` 系、`.toast` 系、`.overlay/.page/.sheet` 系 | ui.js が使う(直接作らない) |
| `@keyframes rise pop fadeIn float shake heartPop bump flash pulse viewIn steam introIn breathe fabIn` | 使ってよい |

`body[data-tab]` に今のタブ、`body.locked` は画面が開いているとき。画面幅 640px 以下がスマホ(シートが下に張り付く)、761px 以上でタブバーが中央。

---

## 5. 機能モジュールの契約(必ず export するもの)

`app.js` はこのとおりに import して使う。無いと起動時にエラーになる。引数が要らないときも関数は置く。

| ファイル | export | 呼ばれ方 |
|---|---|---|
| `recipes.js` | `init()` | ホーム(`#view-recipes`)の一覧・検索・絞り込み。カードを押したら `openDetail(id, { origin })`。「食材から探す」→ `openFridge(origin)`。0件のときの「レシピを追加」→ `openForm()`。ほかのモジュール向けに `currentFilter()`→`{ genre, course }`(登録画面の初期値)、`setQuery(text)`(詳細のタグから `#タグ` で検索)、`revealList()`(保存直後に一覧の先頭までスクロール)も export する |
| `recipe-detail.js` | `init()`、`openDetail(id, { servings?, origin? })` | `servings` を渡すとその人数で開く(今日の献立・献立の1品から)。「献立に追加」→ `openSlotPicker(id, servings, origin)`、「調理モード」→ `openCook(id, servings)`、編集 → `openForm(id)`、動画 → `openPip(recipe, t, origin)`、タイマー → `startTimer(sec, label)`。手順のチップ `stepChips(recipe, step, inCook)` も export し、cook.js が共用する |
| `recipe-form.js` | `init()`、`openForm(id = null, preset = {})` | `preset = { name?, videoUrl?, memo? }`(共有メニューから。app.js が 'share' で呼ぶ)。ジャンル/種類の「編集」→ `openSettings('genres'|'courses', origin)` |
| `cook.js` | `init()`、`openCook(id, servings)` | 調理モードのページ。Wake Lock は `onClose` で解放 |
| `timers.js` | `init()`、`startTimer(sec, label)` | `#timers` に表示。複数同時 |
| `pip.js` | `init()`、`openPip(recipe, t = 0, origin?)`、`closePip()` | `#pip` に小窓。同じ動画なら頭出しだけ。2本指のピンチ(トラックパッドは ctrl+ホイール)で大きさを変えられ、小・大それぞれの幅を `rb2:pipSize` に保存 |
| `plan.js` | `init()`、`openSlotPicker(recipeId, servings, origin?)` | 献立タブ(`#view-plan`)、レシピ選択・1品のシート、「献立に追加」のシート。買い物リストを作ったら `ui.goTab('shop')` |
| `today.js` | `init()` | `#today` に今日の献立。押したら `openDetail(e.recipeId, { servings: e.servings, origin })`。無ければ「献立を決める」→ `ui.goTab('plan')` |
| `shop.js` | `init()`、`addToShop(items)` | 買い物タブ(`#view-shop`)。`items = [{ key, name, amount, recipes?, group:'food'|'season'|'manual' }]`(`recipeNeeds` / `buildShopping` の形)。未購入の同じ key は入れず、入れた数と重複の数を toast で知らせる。戻り値 `Promise<{ added, skipped }>` |
| `fridge.js` | `init()`、`openFridge(origin?)` | 食材から探すシート。「足りないものを買い物リストへ」→ `addToShop(missing)`。「よく使う食材を編集」→ `openSettings('staples', origin)` |
| `settings.js` | `init()`、`openSettings(page = null, origin?)` | 設定のページ(一覧 → 各項目は `ui.pushStep`)。`page`:`null`(一覧)`'account'` `'box'` `'genres'` `'courses'` `'staples'` `'meals'` `'trash'` `'app'`。≡ から app.js が `openSettings(null, menuBtn)` で呼ぶ。「ボックスと共有」の中身は sharing.js の関数を使ってよい |
| `sharing.js` | `init()`、`openBoxMenu(anchor)`、`openJoin()` | 上部バーの「ボックス名 ▾」→ `openBoxMenu(boxBtn)`(`ui.menu` でマイボックス・参加中・「コードで参加」)。`openJoin()` はコード入力のシート。招待コードの発行・メンバー一覧・退出も担当(設定から呼ばれる)。設定の「ボックスと共有」の中身は `buildBoxPanel(container, isVisible)` → `{ render, show, loadInvites }` が作り(settings.js が項目を開くたびに `show()` を呼ぶ)、`paintAvatar(node, user)`(写真 → 頭文字 → 人の形)も export する。招待の文に入れる公開 URL は `APP_URL` に直書き |

モジュール同士は普通に import してよい(循環 import も ES modules では動くが、トップレベルで相手の値を使わないこと。`init()` の中や関数の中で使う)。

### 確認のしかた

- `cd /Users/foooooster/Desktop/recipe-box-2 && python3 -m http.server 5174` → http://localhost:5174/ (5173 は v1)
- 確認用ブラウザでは Service Worker を登録できず、コンソールに `An unknown error occurred when fetching the script.` が1つ出る(無視してよい)。それ以外のエラーが無いこと
- Google ログインはできないので「ログインせずに使う」。クラウドは §1.5 の偽クラウドで(メモリ上の `users[uid]` と `invites` を持ち、`watch*` は登録時に全件を `added` で流し、`put/del/batch` は同じ `uid`・コレクションの購読者に `modified/removed` を流せば、ログイン → 移行 → ボックス名 → 招待 → 参加 → 切り替え → 外す/退出 → ログアウトまで通る。外された側は購読者の `onError({ code:'permission-denied' })` を呼べば再現できる)
- Pixel 幅 412×915 とダークモードで、長い料理名・写真なし・0件でも崩れないこと
- 確認用ペインの癖:ペインが表示されていないと rAF と CSS の transition が進まない。`ui.open` の `.open` はスクリーンショットを1枚挟むと付く(付く前のページは `translate(100%)` のままなので、その中のボタンは押せない)。`resize_window` の 412×915 エミュレーションは計測(`getBoundingClientRect` / `scrollWidth`)には使えるが、ペインが非表示のときはスクリーンショットが撮れない。ダークの計算済みスタイルは transition を切ってから読む(`* { transition: none !important }` を一時的に足す)

## 6. AI で動画からレシピを読み取る(`lib/ai.js`)

Gemini API(REST、ブラウザから直接)に YouTube の URL を渡して、動画の中身から料理名・材料・作り方・人数・時間・タグ・メモを JSON で返してもらう。キーは **設定画面で入れたもの**(`store.ai.key`。`firebase-config.js` には置かない)。モデルは `store.ai.model`(カンマ区切りで複数。混雑(503)や無くなったモデル(404)は次へ。空なら `DEFAULT_MODELS` = `gemini-3.5-flash-lite,gemini-3-flash-preview`)。

`store.ai` は `{ key, model }` の入れ物で、`store.ai.save({ key?, model? })` で保存、変更は `store.on('ai')`。ログイン中は自分の `users/{uid}/meta/ai`(本人だけ。ルールの `meta/{doc}`)、未ログインは `localStorage` の `rb2:ai`。ボックスを切り替えても変わらない(自分のキー)。ログイン時にクラウドに無く端末にあれば送り、送ったら端末のコピーは消す。アカウントが切り替わるたびに `applyAi(null)` でいったん空にする(前の人のキーを残さない)。保存の失敗は自分の uid で `onCloudError` に渡す(見ているボックスから外れないように)。

| export | 役割 |
|---|---|
| `hasAi()` | キーがあるか。false なら登録画面では「AI で動画から…(設定が必要)」のリンクだけ出し、押すと `openSettings('ai')` |
| `testAiKey(key)` | モデル一覧を1件取ってキーを確かめる(無料枠を使わない)。失敗は `code`:`bad-key` `network` `timeout` |
| `extractRecipeFromVideo({ url, title }, { signal })` | 動画は 0.5 コマ/秒・低解像度(`video_metadata.fps` と `mediaResolution`)で送り、読み取って正規化済みの `{ name, servings, timeMinutes, ingredients:[{ name, amount, group }], steps:[{ text, startSec }], tags, notes, confidence }` を返す。300 秒で打ち切り(15 分の動画で 3〜4 分かかる)。失敗は `Error` に `code`:`no-key` `quota`(429)`busy`(混雑、モデルを順に試して 3 秒・8 秒待ち最大 3 巡したあと)`unsupported`(限定公開・長すぎ・非対応)`network` `timeout`(5 分の期限)`aborted`(呼び出し側が止めた)`bad-key` `bad-response`。全モデルが 404 なら `unsupported` |
| `extractToText(r)` | 登録画面のテキスト形式へ(`{ ingredients, steps }`。材料は `名前 分量`、グループは `【タレ】` の行、手順は `m:ss ` の頭出し付き) |
| `aiErrorText(e)` | `code` に応じた日本語の案内文 |
| `DEFAULT_MODELS` | 既定のモデル(設定画面のプレースホルダにも使う) |

`recipe-form.js` の流れ:動画 URL のプレビューでタイトルを取ったあと、`hasAi()` なら `mountAi(...)`。材料・作り方が空(かつ概要欄から入っていない)なら自動で読み取りを始め、そうでなければ「AI で動画から材料・作り方を読み取る」ボタン。結果は `#ai-preview` のシートで見せ、「この内容で入れる」で `applyAi(r)`(料理名は空か動画タイトルの自動入力のままのときだけ置き換え、材料・作り方は置き換え、タグは合流、メモは空のときだけ)。URL を変えたとき・登録画面を閉じたとき・別のレシピを開いたときは `stopAi()` で進行中の呼び出しを止め、`videoSeq` を進めて届きかけの結果も捨てる(成功時も画面が開いていなければ捨てる)。「読み取り結果をもう一度見る」で同じ結果をもう一度開ける。

`settings.js` の `'ai'` ページ:キー(password 入力+表示切替)、モデル(details の中)、「保存して確かめる」(`testAiKey` → `store.ai.save`)、「キーを削除する」。一覧の値は 設定済み/未設定。
