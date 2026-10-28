// Gemini で YouTube の動画を読み取り、レシピ(材料・作り方・人数・時間)を作る
// キーは設定画面で入れたもの(store.ai.key。自分のアカウントに保存され、公開リポジトリには置かない)。無ければ使わない
import { store } from '../store.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
// lite は速くて、混んでいるときは短時間で 503 を返すので先に。preview は遅いが読み取りが安定しているので予備
export const DEFAULT_MODELS = 'gemini-3.5-flash-lite,gemini-3-flash-preview';

export const hasAi = () => !!store.ai.key;
// 使うモデル。カンマ区切りで複数書くと、混雑(503)のときは次のモデルで試す
function modelNames() {
  return String(store.ai.model || DEFAULT_MODELS).split(',').map((x) => x.trim()).filter(Boolean);
}

// キーが使えるか確かめる(モデル一覧を1件だけ取る。無料枠を消費しない)。失敗は Error(code)
export async function testAiKey(key) {
  let res;
  try {
    res = await fetch(`${ENDPOINT}?pageSize=1`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) });
  } catch {
    throw err('network');
  }
  if (res.ok) return true;
  let detail = '';
  try { detail = (await res.json()).error?.message || ''; } catch { /* 本文なし */ }
  if (res.status === 429) throw err('quota', detail);
  throw err(res.status === 400 || res.status === 403 ? 'bad-key' : 'network', detail);
}

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
// 失敗は Error(code: 'no-key' | 'bad-key' | 'quota' | 'busy' | 'unsupported' | 'network' | 'bad-response' | 'timeout' | 'aborted'(呼び出し側が止めた))
export async function extractRecipeFromVideo({ url, title = '' }, { signal } = {}) {
  const key = store.ai.key;
  if (!key) throw err('no-key');
  const ctrl = new AbortController();
  const TOTAL_MS = 300000; // 全体で5分まで(長い動画(15分)は3〜4分かかることがある)
  const PER_MODEL_MS = 150000; // ほかに試せるモデルが残っているときは、1モデル 2分半で見切って次へ
  const deadline = Date.now() + TOTAL_MS;
  const timer = setTimeout(() => ctrl.abort(), TOTAL_MS);
  const onOuter = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) { clearTimeout(timer); throw err('aborted'); }
    signal.addEventListener('abort', onOuter, { once: true });
  }
  const finish = () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onOuter); };
  // 呼び出し側が止めた(URL が変わった・画面を閉じた)のか、5分の期限なのかを区別する
  const stopped = () => err(signal && signal.aborted ? 'aborted' : 'timeout');
  // 0.5 コマ/秒・低解像度で送る(音声は全部入る)。トークンが減って読み取りが 2〜4 倍速くなり、材料・手順の質は変わらない。
  // Gemini 3 系は「考える量」を少なめにすると、同じ質のまま速く安定する
  const bodyFor = (model) => JSON.stringify({
    contents: [{
      parts: [
        { file_data: { file_uri: url }, video_metadata: { fps: 0.5 } },
        { text: `${PROMPT}${title ? `\n\n動画のタイトル: ${title}` : ''}` },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2, mediaResolution: 'MEDIA_RESOLUTION_LOW',
      ...(/^gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
    },
  });
  // 混雑中(503 など)は次のモデルで試し、全部ダメなら少し待ってもう一巡(最大3巡)
  const RETRY_WAIT = [3000, 8000];
  const models = modelNames();
  let text = '';
  let notFound = 0; // この巡で 404 だったモデルの数(全部なら「無いモデル」として知らせる)
  for (let attempt = 0; ; attempt++) {
    if (ctrl.signal.aborted) { finish(); throw stopped(); }
    const model = models[attempt % models.length];
    const firstInRound = attempt % models.length === 0;
    const lastInRound = attempt % models.length === models.length - 1;
    const round = Math.floor(attempt / models.length);
    const moreToTry = !(lastInRound && round >= RETRY_WAIT.length);
    if (firstInRound) notFound = 0;
    // この1回だけの打ち切り(全体の期限か、次があるなら 2分半)。本文の受信まで含める
    const one = new AbortController();
    const onAbort = () => one.abort();
    ctrl.signal.addEventListener('abort', onAbort, { once: true });
    const oneTimer = setTimeout(() => one.abort(), Math.max(1000, Math.min(deadline - Date.now(), moreToTry ? PER_MODEL_MS : TOTAL_MS)));
    let res, body = '', gaveUp = false;
    try {
      res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: one.signal,
        body: bodyFor(model),
      });
      body = await res.text();
    } catch (e) {
      if (ctrl.signal.aborted || !(e && e.name === 'AbortError')) {
        finish();
        throw e && e.name === 'AbortError' ? stopped() : err('network');
      }
      gaveUp = true; // このモデルだけ見切った → 次へ
    } finally {
      clearTimeout(oneTimer);
      ctrl.signal.removeEventListener('abort', onAbort);
    }
    if (gaveUp) {
      if (moreToTry) continue;
      finish();
      throw err('timeout');
    }
    if (res.ok) { text = body; break; }
    let detail = '';
    try { detail = JSON.parse(body).error?.message || ''; } catch { /* 本文なし */ }
    const badKey = (res.status === 400 || res.status === 403) && /api key|api_key|permission/i.test(detail);
    if (badKey) { finish(); throw err('bad-key', detail); }
    if (res.status === 404) notFound++;
    const busy = res.status === 503 || res.status === 500 || res.status === 502 || res.status === 504
      || (res.status === 404 && models.length > 1); // 無くなったモデルも次へ
    if (lastInRound && notFound === models.length) { finish(); throw err('unsupported', detail); }
    if (busy && !lastInRound) continue;
    if (busy && round < RETRY_WAIT.length) {
      if (ctrl.signal.aborted) { finish(); throw stopped(); }
      await new Promise((r, rej) => {
        const t = setTimeout(() => { ctrl.signal.removeEventListener('abort', stop); r(); }, RETRY_WAIT[round]);
        const stop = () => { clearTimeout(t); rej(stopped()); };
        ctrl.signal.addEventListener('abort', stop, { once: true });
      }).catch((e) => { finish(); throw e; });
      continue;
    }
    finish();
    if (res.status === 429) throw err('quota', detail);
    if (res.status === 400 || res.status === 403 || res.status === 404) throw err('unsupported', detail);
    if (busy) throw err('busy', detail);
    throw err('network', detail);
  }
  finish();
  let data;
  try {
    const j = JSON.parse(text);
    const out = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    data = normalizeExtract(JSON.parse(out));
  } catch {
    throw err('bad-response');
  }
  // 何も読み取れていない(料理名も材料も手順も無い)返事は失敗として扱う
  if (!data.name && !data.ingredients.length && !data.steps.length) throw err('bad-response');
  return data;
}

function normalizeExtract(d0) {
  const d = d0 && typeof d0 === 'object' && !Array.isArray(d0) ? d0 : {};
  const s = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const n = (v) => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : 0);
  const obj = (x) => (x && typeof x === 'object' ? x : {});
  const ingredients = Array.isArray(d.ingredients) ? d.ingredients.map(obj)
    .map((x) => ({ name: s(x.name, 80), amount: s(x.amount, 40), group: s(x.group, 30) }))
    .filter((x) => x.name) : [];
  const steps = Array.isArray(d.steps) ? d.steps.map(obj)
    .map((x) => ({ text: s(x.text, 500), startSec: Number.isFinite(+x.startSec) && +x.startSec >= 0 ? Math.round(+x.startSec) : -1 }))
    .filter((x) => x.text) : [];
  const tags = Array.isArray(d.tags) ? [...new Set(d.tags.map((t) => s(t, 20).replace(/^#/, '')).filter(Boolean))].slice(0, 5) : [];
  return {
    name: s(d.name).slice(0, 80),
    servings: Math.min(20, n(d.servings)),
    timeMinutes: Math.min(999, n(d.timeMinutes)),
    ingredients: ingredients.slice(0, 60),
    steps: steps.slice(0, 40),
    tags,
    notes: s(d.notes, 1000),
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
    'no-key': 'AI のキーが設定されていません。設定の「AI で動画を読み取る」から入れてください',
    'bad-key': 'このキーは使えませんでした。Google AI Studio で作ったキーを貼り直してください',
    quota: '今日の無料枠を使い切ったようです。明日また試すか、Google 側で有料プランにしてください',
    unsupported: `この動画は読み取れませんでした。限定公開・非公開の動画や、長すぎる動画、無いモデル名は対象外です${detail}`,
    busy: 'AI が混み合っていて今は読み取れませんでした。少し待ってからもう一度試してください',
    aborted: '読み取りを止めました',
    network: `AI に接続できませんでした。電波の状態を確認してください${detail}`,
    timeout: '5分たっても読み取りが終わらなかったので止めました。短い動画で試すか、あとでもう一度試してください',
    'bad-response': 'AI の返事を読み取れませんでした。もう一度試してください',
  }[code] || `読み取れませんでした(${code || 'unknown'})`;
}

function err(code, detail = '') { const e = new Error(code); e.code = code; e.detail = detail; return e; }
