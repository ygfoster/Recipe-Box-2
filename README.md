# レシピボックス2 🍽

献立づくり → 買い物 → 料理までを支える、自分用のレシピ帳。初代(Recipe Box)をゼロから作り直した第2世代で、**家族・友だちとレシピ帳を共有**できる。

- 公開先:https://ygfoster.github.io/Recipe-Box-2/
- 初代(https://ygfoster.github.io/Recipe-Box/)と**同じ Google アカウント・同じデータ**を使う。どちらで登録しても両方に出る
- 素の HTML / CSS / JS(ES modules)。ビルド不要。GitHub Pages にそのまま置いている
- Android は TWA(`io.github.ygfoster.recipebox2`)。APK は [Releases](https://github.com/ygfoster/Recipe-Box-2/releases) に置く

## 機能

- 写真が主役のレシピカード。検索と予測変換(かな/カナ・全角/半角を吸収、`#タグ`)、ジャンル1行+絞り込み(種類・調理時間・お気に入り・並び替え)
- 詳細:人数に合わせた分量換算、★とお気に入り、作った記録、共有(テキスト)、動画の小窓(YouTube、指で好きな位置へ)、調理モード(画面オン・材料チェック・タイマー)
- 登録:写真、動画URL(YouTube はタイトルを自動入力。API キーがあれば概要欄から材料・作り方も)、ジャンル・種類、調理時間、人数、タグ、材料、作り方、メモ
- 献立(日付 × 使う食事)と買い物リスト(材料を人数換算して自動合算、チェック、左スワイプで削除、共有)
- 冷蔵庫の食材から探す(すぐ作れる → 足りないものが少ない順)
- ゴミ箱(30日で自動削除)、設定(ジャンル・種類・よく使う食材・献立で使う食事)、バックアップ
- **共有(ボックス)**:招待コードを発行して渡すと、相手は自分のアプリで「参加」できる。参加した人はそのボックスのレシピ・献立・買い物リストを読み書きできる

設計の詳細(機能一覧、色の役割、データの形、共有の仕組み)は [docs/SPEC.md](docs/SPEC.md)、モジュールの API は [docs/MODULES.md](docs/MODULES.md)。

## 共有を使うための設定(Firebase)

Firestore のセキュリティルールを [docs/SPEC.md §5.2](docs/SPEC.md) のものに置き換える(Firebase コンソール → Firestore Database → ルール → 公開)。初代もこのルールのまま動く。

## 初代との共存

同じオリジン(`ygfoster.github.io`)で動くため、端末内の保存は名前を分けている(IndexedDB `recipe-box-2`、`localStorage` の `rb2:*`)。Firebase のログイン状態は共有されるので、初代でログイン済みなら2もログイン済みになる。

## ローカルで動かす

```bash
cd ~/Desktop/recipe-box-2 && python3 -m http.server 5174
```

http://localhost:5174/ を開く(初代は 5173)。
