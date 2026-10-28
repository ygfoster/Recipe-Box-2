// タイマー:#timers に表示、複数同時、一時停止/再開、終了で音(WebAudio)+振動(v1 の app.js から移植)
// 見た目は css/recipes.css の .timer。終了は注意色で揺れ、押すと消える
import * as ui from './ui.js';
import { el, uid, fmtClock } from './lib/text.js';

const timers = [];
let timerTick = null;
let actx = null;

// 音は利用者の操作(タイマー開始)のときに準備しておかないと鳴らせない
function unlockAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { /* 音が出せない環境では振動と表示だけで知らせる */ }
}

function beep() {
  if (!actx) return;
  const t0 = actx.currentTime;
  [0, 0.22, 0.44].forEach((d) => {
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
    o.connect(g).connect(actx.destination);
    o.start(t0 + d);
    o.stop(t0 + d + 0.2);
  });
}

export function init() {
  // 器(#timers)は index.html にある。中身はタイマーを始めたときに作る
}

// sec 秒のタイマーを label(「肉じゃが · 10分」など)付きで始める
export function startTimer(sec, label) {
  unlockAudio();
  const t = { id: uid(), label, total: sec * 1000, end: Date.now() + sec * 1000, remain: sec * 1000, paused: false, done: false, beeps: 0, lastBeep: 0 };
  timers.push(t);
  renderTimer(t);
  ui.toast(`⏱ ${label} のタイマーを開始`);
  if (!timerTick) timerTick = setInterval(tickTimers, 250);
}

function renderTimer(t) {
  const node = el('div', 'timer');
  node.dataset.id = t.id;
  const prog = el('span', 't-prog');
  const time = el('span', 't-time');
  const label = el('span', 't-label', t.label);
  const pause = el('button');
  pause.type = 'button';
  pause.setAttribute('aria-label', '一時停止');
  pause.innerHTML = ui.ICON.pause;
  const close = el('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'タイマーを消す');
  close.innerHTML = ui.ICON.close;
  node.append(prog, time, label, pause, close);
  t.node = node;
  pause.onclick = () => {
    if (t.done) return removeTimer(t);
    t.paused = !t.paused;
    if (t.paused) t.remain = t.end - Date.now();
    else t.end = Date.now() + t.remain;
    node.classList.toggle('paused', t.paused);
    pause.innerHTML = t.paused ? ui.ICON.resume : ui.ICON.pause;
    pause.setAttribute('aria-label', t.paused ? '再開' : '一時停止');
  };
  close.onclick = () => removeTimer(t);
  node.addEventListener('click', (e) => { if (t.done && !e.target.closest('button')) removeTimer(t); });
  document.getElementById('timers').append(node);
  updateTimer(t);
}

function updateTimer(t) {
  t.node.querySelector('.t-time').textContent = t.done ? '終了！' : fmtClock(Math.ceil(t.remain / 1000));
  // 進み具合は幅ではなく scaleX で(動きは transform だけ)
  t.node.querySelector('.t-prog').style.transform = `scaleX(${1 - t.remain / t.total})`;
}

function tickTimers() {
  const now = Date.now();
  timers.forEach((t) => {
    if (t.done) {
      // 止めるまで数秒おきに鳴らす(最大1分)
      if (t.beeps < 20 && now - t.lastBeep > 3000) { beep(); t.beeps++; t.lastBeep = now; }
      return;
    }
    if (t.paused) return;
    t.remain = Math.max(0, t.end - now);
    if (t.remain === 0) {
      t.done = true;
      t.node.classList.add('done');
      const b = t.node.querySelector('button');
      b.innerHTML = ui.ICON.check;
      b.setAttribute('aria-label', '止める');
      if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 800]);
      beep();
      t.lastBeep = now;
      ui.toast(`⏰ ${t.label} が終わりました`);
    }
    updateTimer(t);
  });
}

function removeTimer(t) {
  const i = timers.indexOf(t);
  if (i >= 0) timers.splice(i, 1);
  t.node.classList.add('out');
  setTimeout(() => t.node.remove(), 300);
  if (!timers.length) { clearInterval(timerTick); timerTick = null; }
}
