# レシピボックス2 仕様書

最終更新:2026-10-28

## 0. これは何か

レシピボックス(v1、`~/Desktop/recipe-box`)を、**別アプリとしてゼロから作り直す**もの。

- v1 と**同じ Firebase プロジェクト・同じ Google アカウント・同じデータ**を読み書きする。v1 で足したレシピは v2 にも出るし、逆も同じ。v1 側のコードは一切変えない
- 目玉は2つ:**デザインの刷新**と、**家族・友だちとの共有**(招待制の「ボックス」)
- 素の HTML / CSS / JS(ES modules)。ビルドなし。GitHub Pages にそのまま置く
- 公開先:`https://ygfoster.github.io/Recipe-Box-2/`(リポジトリ `ygfoster/Recipe-Box-2`)
- Android:TWA(Bubblewrap)で APK 化。パッケージ名 `io.github.ygfoster.recipebox2`、署名鍵は v1 と共用
- 利用者:本人(MacBook Pro / Pixel 11 Pro の Chrome・TWA アプリ)と、招待した家族・友だち

## 1. 参照する v1 のファイル(ロジックの移植元)

v1 のロジックは実際に使われて動作が確認されている。**アルゴリズムは移植し、コードの構造だけ v2 の設計に合わせて整理する**。読まずに書き直さないこと。

| v1 のファイル | 移植するもの |
|---|---|
| `app.js` | `normalizeRecipe` / `normalizeSettings`、材料解析(`parseIngredient` `scaleAmount` `fmtNum` `parseStep` `findDurations` `AMOUNT_WORDS` `ING_RE`)、動画(`videoInfo` `parseT` `fetchVideoTitle` `fetchYouTubeDetails` `descriptionToRecipe` と関連の正規表現)、`compressImage`/`drawImage`/`makeImg`、検索(`norm` `haystack` `matches` `suggestions` `highlight`)、FLIP の `renderGrid`、PiP 一式(`pip` `openPip` `pipRestore` ドラッグ・慣性・操作ボタン・`onStateChange` 受信)、タイマー一式(`startTimer` `tickTimers` `beep` 振動)、調理モード(`openCook` `requestWake`)、ゴミ箱(`moveToTrash` `restoreRecipe` `deleteForever` `purgeTrash` 30日)、起動画面、戻るジェスチャー(`openOverlay`/`closeOverlay`/`popstate`/`ignorePop`/`_extra`)、設定の各画面、`toast` の「元に戻す」 |
| `plan.js` | `normalizeEntry` `normalizeShopItem`、`buildShopping`(`SEASONINGS` `SKIP_ITEMS` `SEASON_HEADER` `SYNONYMS` `stripNote` `ingKey` `isSeasoning` `parseAmount` `fmtAmount`)、献立の描画、レシピ選択、1品の編集、「献立に追加」、買い物リスト(グループ、チェック、スワイプ削除 `attachSwipe`、すべて削除、片づける、共有テキスト)、今日の献立 |
| `fridge.js` | `recipeNeeds` `knownIngredients` `searchByFridge` `keyMatches` `effectiveStaples` `autoStaples` `addMissingToShop` |
| `cloud.js` | Firebase の初期化(persistent cache)、ログイン(popup → redirect のフォールバック)、`onSnapshot` の使い方、`writeBatch` 450件ずつ、`includeMetadataChanges` で同期状態 |
| `style.css` | 先頭の「色の役割」コメント、`@keyframes`、モバイル用の調整、`prefers-reduced-motion` |
| `sw.js` / `manifest.webmanifest` | オフライン(network-first、3秒でキャッシュ)、`share_target` |
| `README.md` / `REQUIREMENTS.md` | 機能の背景 |

## 2. 機能一覧(v1 と同等 + 共有)

v1 にある機能は**すべて**入れる。ここに無い機能を足さない(足したくなったら本人に聞く)。

### A. レシピ
- **A1 一覧**:写真+料理名のカード。上から「今日の献立(あれば)」→ 検索 → 「冷蔵庫の食材から探す」→ ジャンルのチップ1行 + 右端に「絞り込み」ボタン → 件数と効いている条件のチップ(押すと外せる)→ カード。絞り込みシートで 種類・調理時間(指定なし/15/30/60分以内)・お気に入りだけ・並び替え(新しい順/評価が高い順/よく作る順/最近作ってない順/早くできる順/名前順)。条件は端末に保存
- **A2 検索と予測変換**:料理名・ジャンル・種類・タグ・材料・メモを対象。ひらがな/カタカナ・全角/半角・大文字小文字の違いを吸収。`#` で始めるとタグ候補。候補はサムネイル付き、一致部分は太字、↑↓/Enter で選べる、IME 変換中の Enter は無視
- **A3 詳細**:写真(動画があれば左下に「▶ 再生」、写真のどこを押しても再生)、ジャンル/種類/時間のピル、料理名、共有ボタン(テキストで `navigator.share`、なければコピー)、♥、★5段階(もう一度押すと0)、「献立に追加」「調理モード」、材料(人数ステッパーで換算、換算中は「N人分のレシピから換算しています」、見出し行 `【…】`)、作り方(行頭 `1:23` は動画の頭出しチップ、「10分煮る」はタイマーチップ)、タグ(押すと `#タグ` で検索)、メモ(URL をリンク化)、作った記録(回数・最後の日付・「作った！」フォーム:日付/ひとこと/写真・一覧と削除)、下に 編集(鉛筆・操作色)/削除(ゴミ箱・危険色。1回目で「本当に削除する」に広がり3秒で戻る、2回目でゴミ箱へ。通知に「元に戻す」)
- **A4 登録・編集**:写真(選択・ドラッグ&ドロップ・圧縮して data URL、同期上限 450KB を目安に段階的に縮小)、参考動画の URL(プレビュー、YouTube ならタイトルを料理名に自動入力、API キーがあれば概要欄から材料・作り方・人数を自動入力。すでに入力があれば上書きせずボタン)、料理名(必須、未入力は揺れて知らせる)、ジャンル・種類(設定の選択肢からトグル選択、横に「編集」で設定へ)、調理時間、人数、タグ(スペース区切り、全角/半角とも)、材料(1行1つ)、作り方(1行1手順)、メモ
- **A5 動画の小窓(PiP)**:YouTube を `https://www.youtube.com/embed/{id}?autoplay=1&playsinline=1&rel=0&enablejsapi=1&origin=…&start=…` で埋め込む(**`youtube-nocookie` は使わない**:ログイン情報が使えず Premium でも広告が出るため)。小さいときは動画のどこを持っても動かせる(ゴムのような端の抵抗、離した勢いで少し滑る、画面外に出ない、位置は端末に保存)。タップで ⏸/▶・⤢(大きく)・✕ が出て2.6秒で消える。大きいときは上のバーで動かし、YouTube の操作がそのまま使える。手順のチップから頭出し。YouTube 以外(Instagram/TikTok/X)は「◯◯で開く」ボタン
- **A6 調理モード**:全画面。画面オン(Wake Lock、取得できたら緑の「画面オン」)、材料のチェックと進捗バー(全部そろうと緑+通知)、手順のチェック(番号が✓に)、手順のチップ(頭出し・タイマー)。タイマーは複数同時、一時停止/再開、終了で音(WebAudio)+振動、注意色で揺れる、押すと消える
- **A7 ゴミ箱**:削除は `deletedAt` を付けてゴミ箱へ。30日で自動的に完全削除。設定の「ゴミ箱」画面で 元に戻す/完全に削除(2段階)/空にする(2段階)
- **A8 共有(テキスト)**:料理名・ジャンル等・材料(選択中の人数分)・作り方・動画URL・メモ

### B. 献立
- 期間 3日/1週間/2週間(セグメント)。日付ごとのカードに、設定で選んだ食事(初期値は晩だけ)の枠。料理が入っている枠は設定でオフでも表示
- 枠の「＋」でレシピ選択シート(検索・種類チップ・お気に入り→よく作る→評価→名前の順・トグルで追加/解除・選択中の数)
- 料理を押すと「1品」シート:人数の変更、献立から外す、レシピを見る(献立の人数で開く)
- レシピ画面の「献立に追加」:今日から14日の日付(その日に献立があれば点)、朝/昼/晩(使う食事が1つなら出さない)、人数、同じ枠に同じ料理は入れない
- まとめ:「N品 · 材料 M点」「期間」「買い物リストを作る/更新」
- 削除されたレシピの献立は「削除されたレシピ」と表示し、集計から除く

### C. 買い物リスト
- 献立の材料を人数換算して合算(`buildShopping`)。グループ:食材 / 調味料・常備品(家にあれば買わなくてOK)/ 自分で追加したもの
- 作り直すと「献立から作った未購入」だけ入れ替え。買ったもの・自分で追加したものは残す。同じ材料(書き分けを吸収)は二重に入れない
- 行をタップでチェック(取り消し線→「買ったもの」へ折りたたみ)。左スワイプで削除(少しでゴミ箱ボタン、大きくでそのまま。Mac はホバーでゴミ箱)
- 上の欄から手動追加(「牛乳 1本」のように量も)、重複は知らせる
- 「買ったものを片づける」、「リストをすべて削除」(2段階、通知の「元に戻す」で復元)、共有(テキスト)
- タブバーのバッジに未購入の数

### D. 冷蔵庫の食材から探す
- 食材を入れる(スペース・読点区切りでまとめて可、候補は登録レシピの食材から、よく使う食材をワンタップ)。入れた食材は端末に保存
- 「すぐ作れる → 足りないものが少ない順」。各レシピに「あと N つ:…」または「材料がそろっています」、使う食材。足りないものを買い物リストへ(重複は入れない)
- 「調味料は家にあるものとして探す」切り替え(初期オン)
- 書き分け(たまご/卵、玉葱/玉ねぎ、ぎゅうにゅう/牛乳 …)は同じ食材として扱う

### E. ホーム・起動
- **起動画面**:アプリを起動したときだけ(`sessionStorage`)。アイコン・「レシピボックス」・キャッチコピー「お気に入りの味を、ひとつの場所に。」・「タップしてはじめる」。共有メニューから開いたときは出さない
- **今日の献立**:ホームのいちばん上。献立があれば料理の一覧(押すと献立の人数でレシピを開く)、なければ「まだ決まっていません → 献立を決める」の1行

### F. 設定(右上の ≡)
- 同期の状態(この端末だけ/同期中/同期済み/オフライン/エラー)とアカウント、Google でログイン、ログアウト
- **ボックスと共有**(新):今のボックス、メンバー、招待コードを発行、コードで参加、退出
- レシピの整理:ジャンルを編集 / 種類を編集 / よく使う食材を編集(自動 ⇄ 固定)/ 献立で使う食事 / ゴミ箱 —— 一覧の行を押すと各項目の画面へ(戻るで一覧へ)
- アプリ:ホーム画面に追加 / バックアップを書き出す(JSON)/ 読み込む

### G. 基盤
- Google ログインのゲート画面(「ログインせずに使う」でこの端末だけ)。ログイン後、この端末だけに保存していたレシピ・献立・買い物をクラウドへ移す(1回だけ)
- オフライン:Firestore の persistent cache + Service Worker(アプリ本体をキャッシュ、network-first で3秒待ってキャッシュ)
- 同期状態:右上 ≡ の点はオフライン(注意色)とエラー(危険色)のときだけ
- 共有メニューから登録(`share_target`、`?share_text=…` の URL を拾って登録画面を開く)
- 戻るジェスチャー:開いた画面は開いた順に閉じる。設定の各項目 → 一覧 → 閉じる。献立/買い物タブから戻るとレシピタブへ
- PWA manifest(`id` あり)、ダークモード(`prefers-color-scheme`)
- 古い版が別タブで開いていて IndexedDB の更新が止まったら案内(`onblocked` / `onversionchange`)

### H. 共有(新機能。詳細は §5.2)
- 自分のレシピ帳 = 「マイボックス」。招待コードを発行して家族・友だちに渡すと、相手は自分のアプリで「参加」できる
- 参加した人は、そのボックスのレシピ・献立・買い物リスト・設定(ジャンルなど)を**すべて読み書きできる**(家族で使う前提。閲覧のみは無し)
- 上部バー左の「ボックス名 ▾」でボックスを切り替える。今日の献立・買い物のバッジも今のボックスのもの
- オーナーはメンバーを外せる。メンバーは退出できる。外されたメンバーのアプリは、次に読んだときに権限エラーになるので、そのボックスを一覧から消して知らせる
- ボックス名はオーナーが設定で付けられる(共有される)。初期値は「◯◯のレシピ」(Google の表示名)
- ログインしていないときは、共有の画面は「ログインすると使えます」

## 3. デザイン(刷新)

### 3.1 引き継ぐ原則(本人が繰り返し求めたこと)
1. **1色に1つの意味だけ**。ブランド色はアプリアイコン・起動画面・右下の追加ボタンだけ。操作色は「押せるもの」だけ。選択状態は色相を持たせずインクの反転。状態色(成功)・注意色・危険色・お気に入り色は混ぜない。★評価や換算した数値は色ではなく濃さと太さ
2. **動きは transform と opacity だけ**。高さ・幅・余白・ぼかしは動かさない(スマホでカクつく)。シートは `cubic-bezier(.32,.72,0,1)`、弾むものは `cubic-bezier(.34,1.4,.5,1)`、一覧の並び替えは FLIP、画面の中の高さが変わるときは下の要素を移動で追従。`backdrop-filter` は固定の上部バーとタブバーだけ。`prefers-reduced-motion` で止める
3. **親指の届く範囲**に主要操作:下のタブバー、右下の追加ボタン、詳細の主要アクションは下に固定
4. **情報の主役はレシピ**。操作部品で画面を埋めない。大見出し・キャッチコピーはホームに置かない(起動画面だけ)。最初に見る→次に比べる→最後に行動する、の順に置く
5. **実運用で崩れない**:長い料理名(2行で省略)、長いジャンル名、写真なし、材料なし、0件、重複、削除済みレシピの献立、オフライン、容量超えの写真
6. それっぽい装飾を盛らない。なくても困らないものは削る

### 3.2 v2 の個性(v1 からの違い)
- **「紙のレシピ帳」の温かみ**:背景は暖かいオフホワイト、文字は墨色。無機質なグレー(#f5f5f7)はやめる
- **写真が主役のカード**:写真を全面に使い、料理名は写真の下部に重ねる(下から上へのグラデーションの上に白文字)。メタ(ジャンル・時間)は小さく。カードに影は付けず、角丸 22px。写真が無いレシピは面の色の上に料理名を大きく(白文字にしない)
- **詳細は全画面ページ**:下からスライドして出る(`translate3d(0,100%,0)` → 0)。上に写真(16:10)、スクロールで本文。**下に固定のアクションバー**(「献立に追加」「調理モード」、♥)で、どこまで読んでも親指で押せる。閉じるは左上の「‹」か戻るジェスチャー
- **上部バー**:左に「ボックス名 ▾」(共有の切り替え)、右に ≡。アプリ名は出さない(起動画面とアイコンで足りる)
- **余白と文字は v1 より少し大きめ**。登録画面は項目間 24px、ラベル 13px/600、入力 16px
- **影は浮いているものだけ**(タブバー・追加ボタン・小窓・通知・メニュー)。面同士は `--sunken` の色差と 1px の線で区切る
- **アイコン**:v1 と見分けがつくよう反転。クリーム地(`#F6F4EF`)の角丸に柿色の器と湯気。maskable 版も同じ配色

### 3.3 トークン(確定値。`css/base.css` の `:root` に置く)

```
/* ライト */
--bg: #F6F4EF;  --surface: #FFFFFF;  --sunken: #EFECE5;
--ink: #1B1A18; --ink-2: #6B6761;    --ink-3: #B5B0A7;
--line: rgba(27,26,24,.08);          --fill: rgba(120,114,104,.12);
--brand: #E2552B; --brand-press: #C9481F;
--action: #0066CC; --action-press: #0055AA; --action-tint: rgba(0,102,204,.10);
--selected-bg: #1B1A18; --selected-fg: #FFFFFF;
--success: #1E8E3E; --success-tint: rgba(30,142,62,.12);
--attention: #F2A20C; --attention-ink: #8A5300; --attention-tint: rgba(242,162,12,.16);
--danger: #D70015; --danger-tint: rgba(215,0,21,.10);
--favorite: #E5337E;
--shadow-float: 0 8px 28px rgba(27,26,24,.14), 0 0 0 .5px var(--line);
--ease: cubic-bezier(.2,.8,.2,1); --sheet: cubic-bezier(.32,.72,0,1); --spring: cubic-bezier(.34,1.4,.5,1);
--r-page: 24px; --r-card: 22px; --r-input: 14px;
/* ダーク(prefers-color-scheme: dark) */
--bg: #121110; --surface: #1E1C1A; --sunken: #2A2724;
--ink: #F3F0EA; --ink-2: #A39E95; --ink-3: #57524B;
--line: rgba(255,255,255,.10);       --fill: rgba(120,114,104,.28);
--brand: #F0683F; --brand-press: #E2552B;
--action: #2997FF; --action-press: #0A84FF; --action-tint: rgba(41,151,255,.16);
--selected-bg: #F3F0EA; --selected-fg: #121110;
--success: #32D74B; --success-tint: rgba(50,215,75,.16);
--attention: #FFB340; --attention-ink: #FFB340; --attention-tint: rgba(255,179,64,.18);
--danger: #FF453A; --danger-tint: rgba(255,69,58,.16);
--favorite: #FF4F94;
--shadow-float: 0 8px 28px rgba(0,0,0,.5), 0 0 0 .5px var(--line);
```
フォント:`-apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif`。数字は `font-variant-numeric: tabular-nums`。

### 3.4 共通部品(`css/base.css` で定義し、全モジュールが使う)
`.btn`(`.primary` 操作色 / `.ghost` / `.danger` / `.small` / `.wide`)、`.chip`(`.active` で反転)、`.icon-btn`、`.round-btn`、`.segmented`、`.switch-row`+`.switch`、`.stepper`、`.field`(label/input/textarea/hint、`.shake`)、`.add-row`、`.nav-list`(設定の一覧行)、`.edit-chips`(✕付きチップ)、`.list`(行、区切り線)、`.sheet`(下から出る小さめの画面)、`.page`(全画面ページ)、`.toast`(`.has-action` で「元に戻す」)、`.badge`、`.empty`(0件の案内)、`.skeleton` は不要。

### 3.5 画面ごとの構成
- **ホーム(レシピ)**:上部バー / 今日の献立 / 検索(予測変換)+「冷蔵庫の食材から探す」/ ジャンル1行+絞り込み / 件数+条件チップ / 写真カードのグリッド(スマホ2列、PC は `minmax(240px,1fr)`)/ 0件の案内 / 下にタブバー(左)と追加ボタン(右・ブランド色の器・湯気がゆれる)
- **詳細(ページ)**:写真 → ピル → 料理名+共有+♥ → ★ → 材料(ステッパー)→ 作り方 → タグ → メモ → 作った記録 → 編集/削除。下に固定アクションバー
- **登録・編集(ページ)**:写真枠 → 動画URL → 料理名 → ジャンル → 種類 → 調理時間/人数 → タグ → 材料 → 作り方 → メモ → 保存
- **調理モード(ページ)**:上部に料理名と「画面オン」、材料(進捗バー)、手順カード。PC は2列
- **献立(タブ)**:期間セグメント / まとめカード(品数・材料・期間・買い物リストを作る)/ 日付カード
- **買い物(タブ)**:残りの数 / 追加欄+共有 / グループ / 買ったもの(折りたたみ)/ すべて削除 / 0件の案内
- **食材から探す(シート)**、**絞り込み(シート)**、**献立に追加(シート)**、**1品(シート)**、**レシピ選択(シート)**
- **設定(ページ:一覧 → 各項目)**:同期とアカウント / ボックスと共有 / レシピの整理 / アプリ
- **ボックス切り替え(メニュー)**:上部バー左から。マイボックス・参加中のボックス・「コードで参加」
- **ゲート・起動画面**:全画面

## 4. 色・状態の対応表(迷ったらここ)

| 役割 | 使う場所 |
|---|---|
| ブランド(柿) | アプリアイコン、起動画面、右下の追加ボタン |
| 操作(青) | 主ボタン、リンク、手順の頭出し/タイマーチップ、鉛筆、タグ、フォーカス |
| 選択(インク反転) | 絞り込み・ジャンル・セグメント・スイッチ・タブ・選択した候補 |
| 成功(緑) | 完了、そろった、同期済み、画面オン |
| 注意(黄) | タイマー終了、オフライン、重複の警告 |
| 危険(赤) | 削除、エラー、入力ミス、同期失敗 |
| お気に入り(ピンク) | ♥ だけ |

## 5. データ

### 5.1 Firestore(v1 と完全互換。パスもフィールドも変えない)

ボックス = オーナーの `uid`。データは **`users/{ownerUid}/…`** に置く(自分のボックスは自分の uid)。

| パス | 中身 |
|---|---|
| `users/{uid}/recipes/{id}` | レシピ。`{ id, name, genre, course, time:number|null, servings, tags:string[], photo:dataURL|null, videoUrl, ingredients, steps, memo, favorite, rating:0-5, cooked:[{id,date:'YYYY-MM-DD',note,photo}], deletedAt:number|null, createdAt, updatedAt }`。1件 950,000 文字以内(写真込み) |
| `users/{uid}/plan/{id}` | 献立の1品。`{ id, date:'YYYY-MM-DD', meal:'breakfast'|'lunch'|'dinner', recipeId, servings, createdAt }`。読むのは直近60日より前を除く(`where('date','>=',since)`) |
| `users/{uid}/shopping/{id}` | 買い物の1点。`{ id, key, name, amount, recipes:string[], group:'food'|'season'|'manual', source:'plan'|'manual', checked, createdAt }` |
| `users/{uid}/meta/settings` | `{ genres:string[], courses:string[], staples:string[]|null, meals:string[], boxName?:string }`。`boxName` は v2 で追加(v1 は無視する) |
| `users/{uid}/meta/boxes` | **v2 のみ、本人だけ**。参加しているボックス `{ boxes:[{ ownerUid, ownerName, joinedAt }] }` |
| `users/{uid}/meta/ai` | **v2 のみ、本人だけ**。AI(Gemini)の設定 `{ key:string, model:string }`。公開リポジトリにキーを置かないため、使う人が設定画面で入れる |
| `users/{uid}/members/{memberUid}` | **v2 のみ**。メンバー `{ code, name, photo, joinedAt }` |
| `invites/{code}` | **v2 のみ**。招待 `{ ownerUid, ownerName, createdAt, expiresAt:number(ms) }`。コードは `ABCDEFGHJKMNPQRSTUVWXYZ23456789`(紛らわしい文字を除く)から6文字。有効期限7日 |

- 書き込みは**正規化した完全なドキュメント**を `setDoc` する(v1 と同じ)。v2 だけが知っているフィールドは `boxName` だけにする(v1 の編集で落ちても困らないもの)
- 読み込みは `onSnapshot` + `includeMetadataChanges: true`。`fromCache` と `hasPendingWrites` から同期状態を決める
- まとめ書きは `writeBatch` を 450 件ずつ
- 旧形式の移行(`category` → `genre`、`主菜` → `メイン` など)は v1 と同じ `COURSE_MAP` と `needsMigration` を持つ

### 5.2 共有の仕組み(ボックス)

```
招待:  オーナーが invites/{code} を作る(ownerUid, ownerName, expiresAt = 今+7日)。コードを LINE などで渡す
参加:  参加者が invites/{code} を読む → users/{ownerUid}/members/{自分のuid} を作る({code, name, photo, joinedAt})
       → 自分の users/{自分}/meta/boxes に {ownerUid, ownerName} を追加
利用:  参加者は users/{ownerUid}/recipes|plan|shopping|meta/settings を読み書きできる(ルールが members の存在で判定)
外す:  オーナーが members/{memberUid} を削除。メンバーのアプリは permission-denied を受けたら、そのボックスを meta/boxes から外して通知
退出:  メンバーが自分の members/{自分} を削除し、meta/boxes からも外す
```

**Firestore のセキュリティルール**(本人が Firebase コンソールに貼る。v1 も引き続き動く):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function isOwner(uid) { return signedIn() && request.auth.uid == uid; }
    function isMember(uid) {
      return signedIn() && exists(/databases/$(database)/documents/users/$(uid)/members/$(request.auth.uid));
    }
    function canUse(uid) { return isOwner(uid) || isMember(uid); }
    function invite(code) { return get(/databases/$(database)/documents/invites/$(code)).data; }

    // レシピ・献立・買い物・設定:本人とメンバーが読み書きできる
    match /users/{uid}/recipes/{id}  { allow read, write: if canUse(uid); }
    match /users/{uid}/plan/{id}     { allow read, write: if canUse(uid); }
    match /users/{uid}/shopping/{id} { allow read, write: if canUse(uid); }
    match /users/{uid}/meta/settings { allow read, write: if canUse(uid); }
    // 参加しているボックスの一覧など、本人だけのもの
    match /users/{uid}/meta/{doc}    { allow read, write: if isOwner(uid); }

    // メンバー:一覧は本人とメンバーが見られる。参加は有効な招待コードがあるときだけ自分自身を追加できる
    match /users/{uid}/members/{memberId} {
      allow read: if canUse(uid);
      allow create: if signedIn() && request.auth.uid == memberId && memberId != uid
        && request.resource.data.code is string
        && invite(request.resource.data.code).ownerUid == uid
        && invite(request.resource.data.code).expiresAt > request.time.toMillis();
      allow delete: if isOwner(uid) || (signedIn() && request.auth.uid == memberId);
    }

    // 招待コード:作った本人だけが作成・削除できる。参加する人は読める
    match /invites/{code} {
      allow read: if signedIn();
      allow create: if signedIn() && request.resource.data.ownerUid == request.auth.uid;
      allow delete: if signedIn() && resource.data.ownerUid == request.auth.uid;
    }
  }
}
```

### 5.3 端末内の保存(v1 と同じオリジンで動くので**名前を分ける**)

本番では v1(`/Recipe-Box/`)と v2(`/Recipe-Box-2/`)が **同じオリジン `ygfoster.github.io`** なので、`localStorage` と IndexedDB を共有してしまう。必ず分ける:
- IndexedDB のデータベース名:`recipe-box-2`(ストア `recipes` `plan` `shopping`)。v1 の `recipe-box` には触らない
- `localStorage` のキーは `rb2:` で始める(`rb2:tab` `rb2:sort` `rb2:fridge` `rb2:localOnly` `rb2:box` …)
- `sessionStorage` も `rb2:intro`
- Service Worker のキャッシュ名 `rb2-v1`。scope は `./`(= `/Recipe-Box-2/`)
- Firebase Auth と Firestore のキャッシュはオリジン共有でよい(同じアカウント・同じデータなので、v1 でログインしていれば v2 もログイン済みになる)

ログインしていない「この端末だけ」モードでは IndexedDB に保存し、ボックスは「マイボックス」だけ。

### 5.4 ボックスの状態
- `store.box = { ownerUid, name, isMine }`。選択中のボックスは `rb2:box` に保存(無ければ自分)
- ボックスを切り替えたら、購読をすべて張り直し、`recipes/plan/shop/settings/trash` を入れ替えて全画面を描き直す
- 冷蔵庫の食材・絞り込み条件・タブは端末の設定(ボックスに依らない)

## 6. アーキテクチャ

### 6.1 ファイル構成

```
recipe-box-2/
├─ index.html             骨組み(上部バー・3つのタブの mount・タブバー・追加ボタン・起動画面・ゲート・toast・timers・pip の置き場)
├─ firebase-config.js     window.RB2_FIREBASE_CONFIG(v1 と同じ値)/ window.RB2_YOUTUBE_API_KEY
├─ manifest.webmanifest   id "/Recipe-Box-2/"、name "レシピボックス2"、short_name "レシピ2"、share_target(action "./index.html")
├─ sw.js                  オフライン
├─ icons/                 icon.svg / icon-192.png / icon-512.png / maskable-512.png / apple-touch-icon.png(反転配色)
├─ css/
│   ├─ base.css           トークン・リセット・共通部品・上部バー・タブバー・追加ボタン・起動画面・ゲート・toast
│   ├─ recipes.css        一覧・詳細・登録・調理モード・PiP・タイマー
│   ├─ plan.css           献立・レシピ選択・1品・献立に追加・今日の献立
│   ├─ shop.css           買い物
│   ├─ fridge.css         食材から探す
│   ├─ settings.css       設定の一覧・各項目・ゴミ箱
│   └─ sharing.css        ボックス切り替え・招待・参加・メンバー
├─ js/
│   ├─ app.js             起動:設定読み込み → 各モジュールの init → ゲート/起動画面 → タブ復元
│   ├─ store.js           データ層。IndexedDB / Firestore の切り替え、ボックス、同期状態、イベント
│   ├─ cloud.js           Firebase SDK(10.12.2、gstatic の ES modules)の薄い層。ログイン、購読、書き込み、招待・参加
│   ├─ ui.js              overlay(ページ・シート)の開閉と履歴連動、toast(「元に戻す」)、メニュー、FLIP、タブ切り替え
│   ├─ lib/text.js        norm / uid / lines / el / replay / fmtDate / daysAgo / todayStr / dayFromToday / fmtDay / clamp
│   ├─ lib/ingredients.js parseIngredient / scaleAmount / fmtNum / parseStep / findDurations / parseAmount / fmtAmount / ingKey / stripNote / SYNONYMS / SEASONINGS / isSeasoning / buildShopping / recipeNeeds / keyMatches
│   ├─ lib/video.js       videoInfo / parseT / fetchVideoTitle / fetchYouTubeDetails / descriptionToRecipe
│   ├─ lib/image.js       compressImage / makeImg / heroImage
│   ├─ lib/search.js      haystack / matches / suggestions / highlight
│   ├─ recipes.js         一覧(カード・FLIP)、検索と予測変換、絞り込みシート、件数
│   ├─ recipe-detail.js   詳細ページ、人数換算、★♥、作った記録、共有、編集/削除(ゴミ箱へ)
│   ├─ recipe-form.js     登録・編集ページ、写真、動画プレビューと自動入力、共有メニューからの登録
│   ├─ cook.js            調理モード、Wake Lock
│   ├─ timers.js          タイマー(表示・音・振動)
│   ├─ pip.js             動画の小窓
│   ├─ plan.js            献立タブ、レシピ選択、1品、献立に追加
│   ├─ today.js           ホームの今日の献立
│   ├─ shop.js            買い物タブ(合算は lib/ingredients の buildShopping)
│   ├─ fridge.js          食材から探す
│   ├─ settings.js        設定の一覧と各項目(ジャンル・種類・よく使う食材・食事・ゴミ箱・バックアップ・インストール)
│   └─ sharing.js         ボックス切り替え、招待コード、参加、メンバー、退出
└─ docs/
    ├─ SPEC.md            この文書
    └─ MODULES.md         基盤が公開する API(store / ui / lib)の正確な説明。機能モジュールはこれに従う
```

### 6.2 モジュールのきまり
- すべて ES modules(`<script type="module" src="js/app.js">`)。`window` にはグローバルを置かない(`RB2_*` の設定値だけ例外)
- 機能モジュールは `export function init()` を持ち、`app.js` が決まった順に呼ぶ。自分の画面(ページ・シート)は `ui` の API で**自分で作る**。`index.html` には mount 先(`#view-recipes` `#view-plan` `#view-shop` `#today` `#timers` `#pip`)だけがあり、**機能モジュールは `index.html` と `base.css` と基盤の js を編集しない**(必要なら結合担当に申し送る)
- データは `store` を通す。`store.on('recipes'|'trash'|'plan'|'shop'|'settings'|'box'|'sync'|'auth', fn)` で変更を受け取り、`store.recipes.put(r)` `store.recipes.del(id)` `store.plan.batch(ops)` `store.shop.batch(ops)` `store.settings.save(s)` などで書く。画面はまず自分の状態を更新してから保存を待つ(オフラインで固まらない)
- `ui.page({ id, title, build })` / `ui.sheet({ id, build })` が overlay を作って返す。`ui.open(ov, origin?)` `ui.close(ov)`。戻るジェスチャーと Esc は `ui` が面倒を見る。ページ内の段階(設定の各項目)は `ui.pushStep(ov, fn)` で履歴を積む
- `ui.toast(msg, { label, run }?)`、`ui.menu(anchor, items)`、`ui.flip(container, mutate)`
- 文字列は日本語。コード中のコメントは日本語の常体(です・ます不要、くだけ過ぎない)。利用者に見せる文も丁寧すぎない普通の日本語(v1 と同じ調子)
- 1ファイル 600 行を超えそうなら分ける

### 6.3 index.html の mount 先(基盤が用意する)
```html
<header id="topbar">…ボックス名▾ / ≡…</header>
<main>
  <section id="view-recipes"><div id="today"></div>…</section>
  <section id="view-plan" hidden></section>
  <section id="view-shop" hidden></section>
</main>
<nav id="tabbar">…</nav>
<button id="fab">…</button>
<div id="overlays"></div>   ← ui.page / ui.sheet はここに作る
<div id="pip" hidden></div>
<div id="timers"></div>
<div id="toast"></div>
<div id="intro">…</div>
<div id="gate">…</div>
```

## 7. 作業の分担(ワークフロー)

| 担当 | 書くファイル | 入力 |
|---|---|---|
| 基盤 | `index.html` `firebase-config.js` `manifest.webmanifest` `sw.js` `icons/*` `css/base.css` `js/app.js` `js/store.js` `js/cloud.js` `js/ui.js` `js/lib/*` `docs/MODULES.md` | この SPEC と v1 |
| レシピ | `js/recipes.js` `recipe-detail.js` `recipe-form.js` `cook.js` `timers.js` `pip.js` `css/recipes.css` | SPEC §2A §2E §3 + MODULES.md |
| 献立・買い物 | `js/plan.js` `today.js` `shop.js` `css/plan.css` `shop.css` | SPEC §2B §2C §2E + MODULES.md |
| 食材・設定・共有 | `js/fridge.js` `settings.js` `sharing.js` `css/fridge.css` `settings.css` `sharing.css` | SPEC §2D §2F §2H §5.2 + MODULES.md |
| 結合 | 全ファイル(直す) | 全部。ローカルで動かして確認 |

- 機能担当は他の担当のファイルを編集しない。基盤の API に足りないものがあれば、**自分のモジュール内で補う**か、結合担当への申し送り(戻り値)に書く
- 動作確認は `http://localhost:5174/`(`python3 -m http.server 5174` を `recipe-box-2` で起動)。確認用ブラウザは Service Worker が登録できない(無視してよい)。Google ログインはできないので「ログインせずに使う」モードで確認し、クラウド部分は `store` の差し替え用の偽クラウド(v1 の確認で使った `RB.attachCloud` 相当)で確認する
- Pixel 幅(412×915)とダークモードで崩れないこと。コンソールにエラーが無いこと

## 8. 公開(最後に本人の端末で行う。ワークフローの対象外)

1. `gh repo create ygfoster/Recipe-Box-2 --public` → push → GitHub Pages を main / root で有効化
2. Firebase:§5.2 のルールを本人がコンソールに貼る(承認済みドメインは `ygfoster.github.io` で登録済みなのでそのまま)
3. `ygfoster/ygfoster.github.io` の `.well-known/assetlinks.json` に `io.github.ygfoster.recipebox2` のエントリを追加(署名鍵は v1 と同じ `~/Desktop/recipe-box-android/android.keystore`、SHA-256 も同じ)
4. `~/Desktop/recipe-box-2-android/` に Bubblewrap で TWA を生成(`startUrl /Recipe-Box-2/`、`minSdkVersion 24`)、署名して `RecipeBox2.apk` を GitHub Releases に置く

## 9. 完成の定義

- §2 の機能がすべて動く(v1 と同じ入力で同じ結果になる:分量換算、合算、書き分け、概要欄の読み取り)
- 同じ Google アカウントで v1 と v2 を並べて開くと、同じレシピ・献立・買い物が見える
- 招待 → 参加 → 相手のレシピが見える・編集できる → 外す/退出、の一連が動く(ルール適用後)
- Pixel 幅・ダークモード・長い文字列・0件・写真なしで崩れない
- コンソールにエラーが無い。動きは transform/opacity だけ
- `docs/MODULES.md` が実装と一致している
