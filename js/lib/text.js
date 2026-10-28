// 文字・日付・DOM の小さな道具(v1 の app.js / plan.js から移植)

// 全角/半角・大文字/小文字・カタカナ/ひらがなの違いを吸収
export const norm = (s) => (s || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const lines = (s) => (s || '').split('\n').map((l) => l.trim()).filter(Boolean);
export const todayStr = () => new Date().toLocaleDateString('sv-SE');
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const WEEKDAYS = '日月火水木金土';

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// アニメーション用クラスを付け直して再生
export function replay(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

// 'YYYY-MM-DD' → '10月28日'(今年でなければ年も付ける)
export function fmtDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  const now = new Date();
  return (y === now.getFullYear() ? '' : `${y}年`) + `${m}月${day}日`;
}

export function daysAgo(d) {
  const diff = Math.round((new Date(todayStr()) - new Date(d)) / 864e5);
  return diff <= 0 ? '今日' : diff === 1 ? '昨日' : `${diff}日前`;
}

// 今日から n 日後の 'YYYY-MM-DD'(端末のタイムゾーン)
export function dayFromToday(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
}

// 'YYYY-MM-DD' → '10/28(火)'
export function fmtDay(date) {
  const d = new Date(date + 'T12:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

export function relDay(date) {
  if (date === dayFromToday(0)) return '今日';
  if (date === dayFromToday(1)) return '明日';
  return '';
}

// '1:23' → 83 秒 / 83 → '1:23'
export const toSec = (s) => s.split(':').reduce((a, b) => a * 60 + +b, 0);
export const fmtClock = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(s).padStart(2, '0');
};

// テキストの中の URL をリンクにした DocumentFragment
export function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /https?:\/\/[^\s]+/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    frag.append(text.slice(last, m.index));
    const a = el('a', null, m[0]);
    a.href = m[0];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    frag.append(a);
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

// 小さなイベント発行器。on() は解除関数を返す。受け手の例外は他の受け手に伝えない
export function emitter() {
  const map = new Map();
  return {
    on(ev, fn) {
      if (!map.has(ev)) map.set(ev, new Set());
      map.get(ev).add(fn);
      return () => { const s = map.get(ev); if (s) s.delete(fn); };
    },
    off(ev, fn) { const s = map.get(ev); if (s) s.delete(fn); },
    emit(ev, ...args) {
      const s = map.get(ev);
      if (!s) return;
      [...s].forEach((fn) => {
        try { fn(...args); } catch (e) { console.error(`[${ev}]`, e); }
      });
    },
  };
}
