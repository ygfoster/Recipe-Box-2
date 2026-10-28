// 検索・絞り込み・予測変換・並び替え(v1 の app.js から移植)
import { norm, el } from './text.js';

// 検索の対象になる文字列(料理名・ジャンル・種類・タグ・材料・メモ)
export function haystack(r) {
  return norm([r.name, r.genre, r.course, r.tags.map((t) => '#' + t).join(' '), r.ingredients, r.memo].join(' '));
}

// 絞り込み条件 f = { query:'', genre:'all', course:'all', fav:false, time:0 } に合うか
export function matches(r, f = {}) {
  const genre = f.genre || 'all', course = f.course || 'all';
  if (genre !== 'all' && r.genre !== genre) return false;
  if (course !== 'all' && r.course !== course) return false;
  if (f.fav && !r.favorite) return false;
  if (f.time && !(r.time && r.time <= f.time)) return false;
  const tokens = norm(f.query || '').split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const h = haystack(r);
  return tokens.every((t) => h.includes(t));
}

// 使われているタグを多い順に → [[tag, 件数], ...]
export function allTags(recipes) {
  const count = new Map();
  recipes.forEach((r) => r.tags.forEach((t) => count.set(t, (count.get(t) || 0) + 1)));
  return [...count].sort((a, b) => b[1] - a[1]);
}

// 予測変換の候補(最大6件)。'#' で始めるとタグ候補 [{ tag, n }]、それ以外はレシピ候補 [{ r, score }]
export function suggestions(q, recipes) {
  const raw = q.trim();
  if (raw.startsWith('#') || raw.startsWith('＃')) {
    const nq = norm(raw.slice(1));
    return allTags(recipes).filter(([t]) => norm(t).includes(nq)).slice(0, 6).map(([tag, n]) => ({ tag, n }));
  }
  const nq = norm(raw);
  if (!nq) return [];
  return recipes
    .map((r) => {
      const i = norm(r.name).indexOf(nq);
      let score;
      if (i === 0) score = 0;
      else if (i > 0) score = 1;
      else if (haystack(r).includes(nq)) score = 2;
      else return null;
      return { r, score };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.r.name.length - b.r.name.length)
    .slice(0, 6);
}

// 料理名の中の一致部分を <mark> にした DocumentFragment
export function highlight(name, q) {
  const frag = document.createDocumentFragment();
  const nn = norm(name);
  const nq = norm(q.trim());
  const i = nn.indexOf(nq);
  // 正規化で長さが変わらない場合のみハイライト位置を元の文字列に対応させる
  if (i < 0 || nn.length !== name.length) { frag.append(name); return frag; }
  frag.append(name.slice(0, i), el('mark', null, name.slice(i, i + nq.length)), name.slice(i + nq.length));
  return frag;
}

/* ---------------- 並び替え ---------------- */
export const lastCooked = (r) => r.cooked.reduce((m, c) => (c.date > m ? c.date : m), '');
export const SORTS = {
  new: (a, b) => b.createdAt - a.createdAt,
  rating: (a, b) => b.rating - a.rating || b.favorite - a.favorite || b.createdAt - a.createdAt,
  cooked: (a, b) => b.cooked.length - a.cooked.length || b.createdAt - a.createdAt,
  stale: (a, b) => lastCooked(a).localeCompare(lastCooked(b)) || b.createdAt - a.createdAt,
  time: (a, b) => (a.time || 1e9) - (b.time || 1e9) || b.createdAt - a.createdAt,
  name: (a, b) => a.name.localeCompare(b.name, 'ja'),
};
export const SORT_OPTS = [
  { value: 'new', label: '新しい順' },
  { value: 'rating', label: '評価が高い順' },
  { value: 'cooked', label: 'よく作る順' },
  { value: 'stale', label: '最近作ってない順' },
  { value: 'time', label: '早くできる順' },
  { value: 'name', label: '名前順' },
];
export const TIME_OPTS = [
  { value: 0, label: '指定なし' },
  { value: 15, label: '15分以内' },
  { value: 30, label: '30分以内' },
  { value: 60, label: '60分以内' },
];
