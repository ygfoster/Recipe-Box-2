// Gemini で YouTube の動画を読み取り、レシピ(材料・作り方・人数・時間)を作る
// キーは window.RB2_GEMINI_API_KEY(Google Cloud で「ウェブサイトの制限」をかけたもの)。無ければ使わない
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

export const hasAi = () => typeof window !== 'undefined' && !!window.RB2_GEMINI_API_KEY;
const modelName = () => (typeof window !== 'undefined' && window.RB2_GEMINI_MODEL) || DEFAULT_MODEL;

// 返してほしい形(Gemini の構造化出力)
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', description: '料理名(短く。動画のタイトルの装飾は除く)' },
    servings: { type: 'INTEGER', description: '何人分か。不明なら 0' },
    timeMinutes: { type: 'INTEGER', description: '調理時間(分)。不明なら 0' },
    ingredients: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: '材料名' },
          amount: { type: 'STRING', description: '分量(例: 200g, 大さじ2, 1/2個, 少々)。不明なら空' },
          group: { type: 'STRING', description: '【タレ】【A】などの区分。無ければ空' },
        },
        required: ['name', 'amount', 'group'],
      },
    },
    steps: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING', description: '手順(1文〜2文。火加減や時間も入れる)' },
          startSec: { type: 'INTEGER', description: 'その手順が動画で始まる秒。不明なら -1' },
        },
        required: ['text', 'startSec'],
      },
    },
    tags: { type: 'ARRAY', items: { type: 'STRING' }, description: '特徴のタグ(時短・作り置き・お弁当 など)。最大5つ' },
    notes: { type: 'STRING', description: 'コツやポイント。無ければ空' },
    confidence: { type: 'STRING', description: 'high / medium / low。料理動画でなければ low' },
  },
  required: ['name', 'servings', 'timeMinutes', 'ingredients', 'steps', 'tags', 'notes', 'confidence'],
};

const PROMPT = `この YouTube 動画は料理のレシピ動画です。動画の映像と音声(話している内容・画面の文字)から、家庭で再現できるレシピを日本語で書き起こしてください。
- 材料は動画に出てきたものを全部、分量つきで。分量が言われていない・見えないときは amount を空にする(推測で埋めない)
- 作り方は実際の順番どおり。各手順が始まる動画の秒数を startSec に入れる(分からなければ -1)
- 人数・調理時間は動画で言及があればそれを使い、無ければ 0
- 料理名は短く(「【簡単】」「最高に美味しい」などの装飾は取る)
- 料理のレシピ動画でない場合は confidence を low にして、ingredients と steps は空にする`;

// 動画URL(とヒントのタイトル)からレシピを読み取る → { name, servings, timeMinutes, ingredients, steps, tags, notes, confidence }
// 失敗は Error(code: 'no-key' | 'quota' | 'unsupported' | 'network' | 'bad-response' | 'timeout')
export async function extractRecipeFromVideo({ url, title = '' }, { signal } = {}) {
  const key = typeof window !== 'undefined' ? window.RB2_GEMINI_API_KEY : null;
  if (!key) throw err('no-key');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  let res;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(modelName())}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{
          parts: [
            { file_data: { file_uri: url } },
            { text: `${PROMPT}${title ? `\n\n動画のタイトル: ${title}` : ''}` },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2 },
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    throw err(e && e.name === 'AbortError' ? 'timeout' : 'network');
  }
  clearTimeout(timer);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch { /* 本文なし */ }
    if (res.status === 429) throw err('quota', detail);
    if (res.status === 400 || res.status === 403 || res.status === 404) throw err('unsupported', detail);
    throw err('network', detail);
  }
  let data;
  try {
    const j = await res.json();
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    data = JSON.parse(text);
  } catch {
    throw err('bad-response');
  }
  return normalizeExtract(data);
}

function normalizeExtract(d) {
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const n = (v) => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : 0);
  const ingredients = Array.isArray(d.ingredients) ? d.ingredients
    .map((x) => ({ name: s(x && x.name), amount: s(x && x.amount), group: s(x && x.group) }))
    .filter((x) => x.name) : [];
  const steps = Array.isArray(d.steps) ? d.steps
    .map((x) => ({ text: s(x && x.text), startSec: Number.isFinite(+(x && x.startSec)) && +x.startSec >= 0 ? Math.round(+x.startSec) : -1 }))
    .filter((x) => x.text) : [];
  const tags = Array.isArray(d.tags) ? [...new Set(d.tags.map(s).filter(Boolean))].slice(0, 5) : [];
  return {
    name: s(d.name).slice(0, 80),
    servings: Math.min(20, n(d.servings)),
    timeMinutes: Math.min(999, n(d.timeMinutes)),
    ingredients: ingredients.slice(0, 60),
    steps: steps.slice(0, 40),
    tags,
    notes: s(d.notes),
    confidence: ['high', 'medium', 'low'].includes(s(d.confidence)) ? s(d.confidence) : 'medium',
  };
}

// 読み取った結果を、登録画面の材料欄・作り方欄のテキストにする
export function extractToText(r) {
  const ing = [];
  let group = '';
  r.ingredients.forEach((x) => {
    if (x.group && x.group !== group) { group = x.group; ing.push(`【${group.replace(/^[【\[]|[】\]]$/g, '')}】`); }
    ing.push(x.amount ? `${x.name} ${x.amount}` : x.name);
  });
  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const steps = r.steps.map((x) => (x.startSec >= 0 ? `${fmt(x.startSec)} ${x.text}` : x.text));
  return { ingredients: ing.join('\n'), steps: steps.join('\n') };
}

export function aiErrorText(e) {
  const code = (e && e.code) || '';
  const detail = (e && e.detail) ? `(${e.detail.slice(0, 80)})` : '';
  return {
    'no-key': 'AI のキーが設定されていません',
    quota: '今日の無料枠を使い切ったようです。明日また試すか、Google 側で有料プランにしてください',
    unsupported: `この動画は読み取れませんでした。限定公開・非公開の動画や、長すぎる動画は対象外です${detail}`,
    network: `AI に接続できませんでした。電波の状態を確認してください${detail}`,
    timeout: '読み取りに時間がかかりすぎたので止めました。短い動画で試してください',
    'bad-response': 'AI の返事を読み取れませんでした。もう一度試してください',
  }[code] || `読み取れませんでした(${code || 'unknown'})`;
}

function err(code, detail = '') { const e = new Error(code); e.code = code; e.detail = detail; return e; }
