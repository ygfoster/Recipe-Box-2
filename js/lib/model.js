// データの形:既定値、旧形式の変換、整形(v1 の app.js / plan.js から移植)。状態に依存しない
import { uid } from './text.js';

export const DEFAULT_SETTINGS = {
  genres: ['和食', '洋食', '中華'],
  courses: ['メイン', 'サイド', 'スープ'],
  staples: null, // よく使う食材。null の間はレシピから自動で選ぶ
  meals: ['dinner'], // 献立で使う食事(朝 breakfast・昼 lunch・晩 dinner)
  boxName: '', // ボックスの名前(v2 だけが使う。v1 は無視する)
};
export const MEAL_ORDER = ['breakfast', 'lunch', 'dinner'];
export const MEAL_SHORT = { breakfast: '朝', lunch: '昼', dinner: '晩' };
export const MEALS = [
  { id: 'breakfast', label: '朝', long: '朝ごはん' },
  { id: 'lunch', label: '昼', long: '昼ごはん' },
  { id: 'dinner', label: '晩', long: '晩ごはん' },
];
// 以前の種類名を新しい呼び方に置き換える
export const COURSE_MAP = { 主菜: 'メイン', 副菜: 'サイド', 汁物: 'スープ', 主食: 'ライス' };
export const TRASH_DAYS = 30;
export const MAX_DOC = 950000; // Firestore の1件あたりの上限(1MB)に余裕をもたせる
export const INVITE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 紛らわしい文字(0/O、1/I/L)を除く
export const INVITE_DAYS = 7;
// 旧形式(category や「主菜」などの旧い種類名)のデータか
export const needsMigration = (raw) => !('genre' in raw) || !!COURSE_MAP[raw.course];

export function normalizeSettings(s) {
  const list = (v, d) => (Array.isArray(v)
    ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))].slice(0, 30)
    : d.slice());
  return {
    genres: list(s && s.genres, DEFAULT_SETTINGS.genres),
    courses: list(s && s.courses, DEFAULT_SETTINGS.courses).map((c) => COURSE_MAP[c] || c),
    staples: s && Array.isArray(s.staples) ? list(s.staples, []) : null,
    meals: (() => {
      const m = s && Array.isArray(s.meals) ? MEAL_ORDER.filter((x) => s.meals.includes(x)) : [];
      return m.length ? m : DEFAULT_SETTINGS.meals.slice();
    })(),
    boxName: s && typeof s.boxName === 'string' ? s.boxName.trim().slice(0, 30) : '',
  };
}

export function normalizeRecipe(r) {
  const s = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const img = (v) => (typeof v === 'string' && v.startsWith('data:image/') ? v : null);
  return {
    id: s(r.id) || uid(),
    name: s(r.name).trim() || '無題のレシピ',
    genre: s(r.genre || r.category).trim(),
    course: COURSE_MAP[s(r.course)] || s(r.course).trim(),
    time: +r.time > 0 ? Math.round(+r.time) : null,
    servings: +r.servings > 0 ? Math.round(+r.servings) : 2,
    tags: Array.isArray(r.tags) ? [...new Set(r.tags.map(s).map((t) => t.trim().replace(/^[#＃]+/, '')).filter(Boolean))].slice(0, 20) : [],
    photo: img(r.photo),
    videoUrl: s(r.videoUrl).trim(),
    ingredients: s(r.ingredients),
    steps: s(r.steps),
    memo: s(r.memo),
    favorite: !!r.favorite,
    rating: Math.max(0, Math.min(5, Math.round(+r.rating || 0))),
    cooked: Array.isArray(r.cooked)
      ? r.cooked.filter((c) => c && /^\d{4}-\d{2}-\d{2}/.test(s(c.date)))
        .map((c) => ({ id: s(c.id) || uid(), date: s(c.date).slice(0, 10), note: s(c.note), photo: img(c.photo) }))
      : [],
    deletedAt: +r.deletedAt > 0 ? +r.deletedAt : null, // ゴミ箱に入れた日時
    createdAt: +r.createdAt || Date.now(),
    updatedAt: +r.updatedAt || Date.now(),
  };
}

// 献立の1品
export function normalizeEntry(e) {
  return {
    id: String(e.id || uid()),
    date: String(e.date || '').slice(0, 10),
    meal: MEAL_ORDER.includes(e.meal) ? e.meal : 'dinner',
    recipeId: String(e.recipeId || ''),
    servings: Math.max(1, Math.min(20, Math.round(+e.servings || 2))),
    createdAt: +e.createdAt || Date.now(),
  };
}

// 買い物の1点
export function normalizeShopItem(s) {
  return {
    id: String(s.id || uid()),
    key: String(s.key || ''),
    name: String(s.name || '').trim() || '(名前なし)',
    amount: String(s.amount || ''),
    recipes: Array.isArray(s.recipes) ? s.recipes.map(String).slice(0, 10) : [],
    group: ['food', 'season', 'manual'].includes(s.group) ? s.group : 'manual',
    source: s.source === 'plan' ? 'plan' : 'manual',
    checked: !!s.checked,
    createdAt: +s.createdAt || Date.now(),
  };
}
