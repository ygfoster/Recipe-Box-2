// 材料・手順の解析、買い物リストの合算、食材から探す(v1 の app.js / plan.js / fridge.js から移植)
// どれも状態に依存しない。レシピの一覧が要るものは引数で受け取る
import { norm, lines } from './text.js';

/* ---------------- 材料の1行 ---------------- */
export const AMOUNT_WORDS = '少々|適量|適宜|ひとつまみ|お好みで|少量|たっぷり|ひとかけ';
export const ING_RE = new RegExp(`^(.+?)[\\s:・…]*((?:大さじ|小さじ|カップ|約)?\\s*\\d[\\d.\\/]*.*|${AMOUNT_WORDS})$`);
const NUM_RE = /(\d+)と(\d+)\/(\d+)|(\d+(?:\.\d+)?)(?:\/(\d+))?/g;

// '玉ねぎ 1個' → { name:'玉ねぎ', amount:'1個' }。'【タレ】' → { header:true, name:'タレ' }
export function parseIngredient(line) {
  const s = line.normalize('NFKC').replace(/⁄/g, '/').trim();
  if (/^[【[<＜■◆●◇]/.test(s)) return { header: true, name: s.replace(/^[【[<＜■◆●◇]\s*|\s*[】\]>＞]$/g, '') };
  const m = s.match(ING_RE);
  return { name: (m ? m[1] : s).trim(), amount: m ? m[2].trim() : '' };
}

// 1.5 → '1と1/2'、0.25 → '1/4'、12.3 → '12'
export function fmtNum(x) {
  if (x >= 10) return String(Math.round(x));
  const w = Math.floor(x + 1e-9);
  const f = x - w;
  const fr = [[0, ''], [1 / 4, '1/4'], [1 / 3, '1/3'], [1 / 2, '1/2'], [2 / 3, '2/3'], [3 / 4, '3/4'], [1, '']];
  for (const [v, str] of fr) {
    if (Math.abs(f - v) < 0.04) {
      const W = v === 1 ? w + 1 : w;
      if (!str) return String(W);
      return W ? `${W}と${str}` : str;
    }
  }
  return String(Math.round(x * 10) / 10);
}

// 量の中の数字をすべて k 倍する(「1枚(300g)」→「2枚(600g)」)
export function scaleAmount(amount, k) {
  if (k === 1) return amount;
  return amount.replace(NUM_RE, (all, a, b, c, n, d) => {
    const v = a ? +a + +b / +c : +n / (d ? +d : 1);
    return fmtNum(v * k);
  });
}

// レシピの材料を k 倍した行の一覧。{ header, name } または { name, amount, scaled, changed }
export function ingredientRows(r, k) {
  return lines(r.ingredients).map((l) => {
    const p = parseIngredient(l);
    if (p.header) return p;
    const scaled = scaleAmount(p.amount, k);
    return { ...p, scaled, changed: scaled !== p.amount };
  });
}

/* ---------------- 手順の1行 ---------------- */
const toSec = (s) => s.split(':').reduce((a, b) => a * 60 + +b, 0);

// '1:23 玉ねぎを炒める' → { t:83, text:'玉ねぎを炒める' }。時間がなければ t:null
export function parseStep(line) {
  const s = line.normalize('NFKC');
  const m = s.match(/^[[(【]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[\])】]?\s*[-–—:]?\s*(.*)$/);
  if (m && m[2]) return { t: toSec(m[1]), text: m[2] };
  return { t: null, text: s };
}

// 「10分煮る」「1時間30分」などからタイマー候補を拾う → [{ sec, label }]
export function findDurations(text) {
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s*時間(?:\s*(\d+)\s*分)?|(\d+(?:\.\d+)?)\s*分(?:\s*(\d+)\s*秒)?|(\d+)\s*秒/g;
  let m;
  while ((m = re.exec(text))) {
    const sec = m[1] ? m[1] * 3600 + (+m[2] || 0) * 60 : m[3] ? m[3] * 60 + (+m[4] || 0) : +m[5];
    if (sec >= 5 && sec <= 6 * 3600) out.push({ sec, label: m[0].replace(/\s/g, '') });
  }
  return out;
}

/* ---------------- 買い物リスト(献立の材料を合算) ---------------- */
// 家にあることが多いもの。「調味料・常備品」にまとめて、買う必要があるか確認しやすくする
export const SEASONINGS = new Set([
  '塩', '砂糖', 'しょうゆ', '醤油', '酒', '料理酒', 'みりん', '酢', '味噌', 'みそ', 'こしょう', '胡椒', '塩こしょう', '塩胡椒',
  '油', 'サラダ油', 'ごま油', 'オリーブオイル', 'バター', '片栗粉', '小麦粉', '薄力粉', '強力粉', 'パン粉', '顆粒だし',
  '和風だし', 'だしの素', 'ほんだし', 'コンソメ', '鶏がらスープの素', 'ケチャップ', 'マヨネーズ', 'ソース', 'ウスターソース',
  '中濃ソース', 'オイスターソース', '豆板醤', '甜麺醤', 'コチュジャン', 'めんつゆ', '白だし', 'ポン酢', 'はちみつ', 'ナンプラー',
  'カレー粉', '一味', '七味', 'ラー油', 'チューブにんにく', 'チューブ生姜', 'にんにくチューブ', '生姜チューブ',
].map((x) => norm(x)));
export const SKIP_ITEMS = new Set(['水', 'お湯', '湯', '熱湯', 'ぬるま湯', '氷'].map((x) => norm(x)));
export const SEASON_HEADER = /調味料|タレ|たれ|ソース|合わせ|ドレッシング/;
const PREFIX_UNITS = ['大さじ', '小さじ', 'カップ'];
const UNIT_ALIAS = { グラム: 'g', cc: 'ml', mL: 'ml', ミリリットル: 'ml', こ: '個', コ: '個', ケ: '個', かけ: '片' };

// 「玉ねぎ(みじん切り)」「・玉ねぎ」なども同じ材料として扱う
export const stripNote = (name) => name.replace(/[（(][^）)]*[）)]/g, '').replace(/^[・\-－●○◎※*＊]+/, '').trim();
// 漢字・ひらがなの書き分けが多い食材は、同じものとして扱う
export const SYNONYMS = new Map(Object.entries({
  たまご: '卵', 玉子: '卵', 玉葱: '玉ねぎ', たまねぎ: '玉ねぎ', にんじん: '人参', 馬鈴薯: 'じゃがいも', 生姜: 'しょうが',
  挽肉: 'ひき肉', 挽き肉: 'ひき肉', 合挽き肉: '合いびき肉', 合い挽き肉: '合いびき肉', 葱: 'ねぎ', 長葱: '長ねぎ',
  胡瓜: 'きゅうり', 茄子: 'なす', 大蒜: 'にんにく', 椎茸: 'しいたけ', とり肉: '鶏肉', 鳥肉: '鶏肉', 南瓜: 'かぼちゃ',
  ぎゅうにゅう: '牛乳', ご飯: 'ごはん', 御飯: 'ごはん', はくさい: '白菜', だいこん: '大根', ほうれん草: 'ほうれんそう',
  しょう油: 'しょうゆ', 醤油: 'しょうゆ', 胡椒: 'こしょう', 味噌: 'みそ',
}).map(([k, v]) => [norm(k), norm(v)]));
// 材料名 → 同じものをまとめるためのキー
export const ingKey = (name) => {
  const k = norm(stripNote(name)).replace(/[\s・]/g, '');
  return SYNONYMS.get(k) || k;
};
export const isSeasoning = (name, header) => {
  const k = ingKey(name);
  return SEASONINGS.has(k) || /(油|ソース|だし|の素|酢)$/.test(k) || SEASON_HEADER.test(header || '');
};

// 量を「数 + 単位」に分ける(k 倍して)。「少々」などはそのまま文字で持つ
export function parseAmount(amount, k) {
  const s = amount.normalize('NFKC').replace(/⁄/g, '/').replace(/\s/g, '');
  if (!s) return null;
  const m = s.match(/(\d+)と(\d+)\/(\d+)|(\d+(?:\.\d+)?)(?:\/(\d+))?/);
  if (!m) return { text: amount.trim() };
  let qty = m[1] ? +m[1] + m[2] / m[3] : +m[4] / (m[5] ? +m[5] : 1);
  const before = s.slice(0, m.index).replace(/約|およそ/g, '');
  let after = s.slice(m.index + m[0].length);
  // 「2〜3個」は多いほうで買う
  const range = after.match(/^[~〜～\-ー](\d+(?:\.\d+)?)/);
  if (range) { qty = +range[1]; after = after.slice(range[0].length); }
  after = after.replace(/[（(].*$/, '');
  if (PREFIX_UNITS.includes(before)) return { qty: qty * k, unit: before, prefix: true };
  let unit = (after || before).trim();
  unit = UNIT_ALIAS[unit] || unit;
  if (unit.length > 6) return { text: amount.trim() };
  return { qty: qty * k, unit, prefix: false };
}

// 単位ごとの量(Map)と文字の量(Set)を '2個 + 100g' のように1つの文字列にする
export function fmtAmount(units, texts) {
  const parts = [...units.values()].map((u) => (u.prefix ? `${u.unit}${fmtNum(u.qty)}` : `${fmtNum(u.qty)}${u.unit}`));
  if (!parts.length && texts.size) parts.push([...texts].join('・'));
  return parts.join(' + ');
}

// 献立の料理の材料を、人数分に換算して合算する
// entries: 献立の1品 [{ recipeId, servings }]、getRecipe: id → レシピ(無ければ undefined)
// 戻り値: [{ key, name, group:'food'|'season', amount, recipes:[料理名] }]
export function buildShopping(entries, getRecipe) {
  const map = new Map();
  entries.forEach((e) => {
    const r = getRecipe(e.recipeId);
    if (!r) return;
    const k = e.servings / r.servings;
    let header = '';
    lines(r.ingredients).forEach((line) => {
      const p = parseIngredient(line);
      if (p.header) { header = p.name; return; }
      const name = stripNote(p.name);
      const key = ingKey(p.name);
      if (!key || SKIP_ITEMS.has(key)) return;
      let it = map.get(key);
      if (!it) {
        it = { key, name, group: isSeasoning(p.name, header) ? 'season' : 'food', units: new Map(), texts: new Set(), recipes: new Set() };
        map.set(key, it);
      }
      it.recipes.add(r.name);
      const a = parseAmount(p.amount || '', k);
      if (!a) return;
      if (a.text) { it.texts.add(a.text); return; }
      const uk = (a.prefix ? 'p:' : '') + a.unit;
      const u = it.units.get(uk) || { unit: a.unit, prefix: a.prefix, qty: 0 };
      u.qty += a.qty;
      it.units.set(uk, u);
    });
  });
  return [...map.values()].map((it) => ({
    key: it.key, name: it.name, group: it.group, amount: fmtAmount(it.units, it.texts), recipes: [...it.recipes],
  }));
}

/* ---------------- 食材から探す ---------------- */
// 「玉ねぎ」で「新玉ねぎ」も、「卵」で「卵黄」も見つかるようにする
export function keyMatches(recipeKey, haveKey) {
  if (recipeKey === haveKey) return true;
  const inside = (a, b) => (b.length >= 2 ? a.includes(b) : a.startsWith(b));
  return inside(recipeKey, haveKey) || inside(haveKey, recipeKey);
}

// レシピごとの材料(見出し・水は除く) → [{ key, name, amount, season }]
export function recipeNeeds(r) {
  const out = [];
  const seen = new Set();
  let header = '';
  lines(r.ingredients).forEach((line) => {
    const p = parseIngredient(line);
    if (p.header) { header = p.name; return; }
    const key = ingKey(p.name);
    if (!key || SKIP_ITEMS.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push({ key, name: stripNote(p.name), amount: p.amount || '', season: isSeasoning(p.name, header) });
  });
  return out;
}

// 登録済みレシピに出てくる食材(入力候補とよく使う食材に使う) → [{ key, name, season, count }]
export function knownIngredients(recipes) {
  const map = new Map();
  recipes.forEach((r) => recipeNeeds(r).forEach((n) => {
    const it = map.get(n.key) || { key: n.key, name: n.name, season: n.season, count: 0 };
    it.count++;
    map.set(n.key, it);
  }));
  return [...map.values()];
}

// よく使う食材を登録レシピから自動で選ぶ(調味料を除いて出現回数順に14個)
export function autoStaples(recipes) {
  return knownIngredients(recipes)
    .filter((it) => !it.season)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'))
    .slice(0, 14)
    .map((it) => it.name);
}

// よく使う食材:設定で決めていればそれを、なければ登録レシピによく出てくるものを使う
export function effectiveStaples(settings, recipes) {
  return Array.isArray(settings.staples) ? settings.staples : autoStaples(recipes);
}

// 冷蔵庫の食材(items: 食材名の配列)で作れるレシピを「足りないものが少ない順」に
// seasonOk: 調味料は家にあるものとして探す → [{ r, used, missing }]
export function searchByFridge(recipes, items, seasonOk = true) {
  const have = items.map((x) => ingKey(x));
  if (!have.length) return [];
  return recipes
    .map((r) => {
      const needs = recipeNeeds(r).filter((n) => !(seasonOk && n.season));
      if (!needs.length) return null;
      const used = needs.filter((n) => have.some((h) => keyMatches(n.key, h)));
      if (!used.length) return null;
      const missing = needs.filter((n) => !used.includes(n));
      return { r, used, missing };
    })
    .filter(Boolean)
    .sort((a, b) => a.missing.length - b.missing.length || b.used.length - a.used.length
      || b.r.favorite - a.r.favorite || a.r.name.localeCompare(b.r.name, 'ja'));
}
