// 動画 URL の解釈と、YouTube からの情報取得(v1 の app.js から移植)

// 't=1h2m3s' / 't=83' → 秒
export function parseT(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return +t;
  const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

// URL → { type:'youtube', id, url, thumb, start } | { type:'link', url, label } | null
export function videoInfo(url) {
  if (!url) return null;
  let u;
  try { u = new URL(url.trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^(www|m)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host.endsWith('youtube.com')) {
    id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]+)/) || [])[1];
  }
  if (id && /^[\w-]{6,}$/.test(id)) {
    return { type: 'youtube', id, url: u.href, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, start: parseT(u.searchParams.get('t')) };
  }
  const label = /instagram/.test(host) ? 'Instagram' : /tiktok/.test(host) ? 'TikTok'
    : /(^|\.)x\.com$|twitter/.test(host) ? 'X' : /youtube/.test(host) ? 'YouTube' : host;
  return { type: 'link', url: u.href, label };
}

// oEmbed で動画のタイトルを取る(YouTube → noembed の順に試す)
export async function fetchVideoTitle(url) {
  const eps = [
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
    `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
  ];
  for (const ep of eps) {
    try {
      const res = await fetch(ep);
      if (!res.ok) continue;
      const j = await res.json();
      if (j.title) return j.title;
    } catch { /* 次の取得先を試す */ }
  }
  return null;
}

// YouTube の公式 API で、タイトルと概要欄を取る(firebase-config.js に API キーがあるときだけ)
export async function fetchYouTubeDetails(id) {
  const key = typeof window !== 'undefined' ? window.RB2_YOUTUBE_API_KEY : null;
  if (!key) return null;
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const j = await res.json();
    const sn = j.items && j.items[0] && j.items[0].snippet;
    return sn ? { title: sn.title || '', description: sn.description || '' } : null;
  } catch {
    return null;
  }
}

// 概要欄から「材料」「作り方」を読み取る。料理動画でよくある書き方に合わせた手がかりで探す
export const DESC_ING = /^[\s【\[■◆●◇▼▽<＜《〈(（]*(材料|食材|ingredients?)/i;
export const DESC_STEP = /^[\s【\[■◆●◇▼▽<＜《〈(（]*(作り方|つくり方|手順|how\s*to)/i;
export const DESC_STOP = /^(https?:|#|▼|▽|-{3,}|={3,}|_{3,}|━|─|【?(使用|おすすめ|チャンネル|関連|お仕事|BGM|撮影|instagram|twitter|tiktok|sns|お問い合わせ)|チャンネル登録|使用(した)?(調理)?器具)/i;
export const DESC_SKIP_STEP = /^(オープニング|イントロ|エンディング|試食|はじめに|おわりに|まとめ)/;

// 概要欄 → { servings:number|null, ingredients:string[], steps:string[] } | null(見つからなければ)
export function descriptionToRecipe(desc) {
  const ing = [];
  const steps = [];
  let mode = null;
  let servings = null;
  // ①②… は全角半角の統一で「1」になってしまうので、先に行頭から外す
  const text = desc.replace(/^[ \t　]*[①-⑳❶-❿➀-➉]\s*/gm, '').normalize('NFKC');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const short = line.length <= 30;
    if (short && DESC_ING.test(line)) {
      mode = 'ing';
      const m = line.match(/(\d+)\s*(人|名)/);
      if (m) servings = +m[1];
      // 「材料:豚肉200g、玉ねぎ1個」のように1行で書いてある場合
      const rest = line.split(/[:：]/).slice(1).join(':').trim();
      if (rest) rest.split(/[、,]/).map((x) => x.trim()).filter(Boolean).forEach((x) => ing.push(x));
      continue;
    }
    if (short && DESC_STEP.test(line)) { mode = 'steps'; continue; }
    if (DESC_STOP.test(line)) { if (mode) mode = 'stop'; continue; }
    if (mode === 'ing') {
      // 【A】(タレ)などの小見出し
      const sub = line.match(/^[【\[<＜■◆●◇(（]\s*([^】\]>＞)）]{1,12})\s*[】\]>＞)）]?$/);
      if (sub && line.length <= 14) { ing.push(`【${sub[1].trim()}】`); continue; }
      const item = line
        .replace(/^[・\-－●○◎◇◆■□*＊✓✔☆★]+\s*/, '')
        .replace(/\s*(?:[…‥]+|\.{2,}|・{2,}|．{2,}|[:：]|\s{2,}|\t)\s*/, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (item) ing.push(item);
    } else if (mode === 'steps') {
      const step = line.replace(/^(?:step\s*\d+[.:：)]?|\d+[.)．、]|[①-⑳]|\(\d+\)|（\d+）)\s*/i, '').trim();
      const body = step.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, '');
      if (step && !DESC_SKIP_STEP.test(body)) steps.push(step);
    }
  }
  if (!ing.length && !steps.length) return null;
  return { servings, ingredients: ing.slice(0, 60), steps: steps.slice(0, 40) };
}
