// 動画の小窓(PiP):YouTube を youtube.com で埋め込む(nocookie は使わない。ログイン情報が使えず広告が出るため)
// 小さいとき:動画のどこを持っても動かせる(ゴムのような端の抵抗、離した勢いで少し滑る、画面外に出ない、位置は端末に保存)
// 大きいとき:上のバーで動かし、YouTube の操作がそのまま使える。v1 の app.js から移植
// 大きさ:2本指のピンチ(小さいときは動画の上、大きいときは上のバー)か、トラックパッドのピンチ(ctrl+ホイール)で自由に変えられる。小・大それぞれの幅を端末に保存
import { store } from './store.js';
import * as ui from './ui.js';
import { el, replay, clamp } from './lib/text.js';
import { videoInfo } from './lib/video.js';

const pip = {
  el: null,
  inner: null,
  frameBox: null,
  titleEl: null,
  frame: null,
  vid: null,
  recipeId: null,
  big: false,
  playing: true,
  pos: null, // 画面に対する割合で覚える(回転・リサイズしても位置がずれない)
  size: { small: 0, big: 0 }, // ピンチで決めた幅(px)。0 なら標準の大きさ
  x: 0,
  y: 0,
};
const PIP_BAR = 40;
const PIP_M = 10;
const PIP_MIN_W = 150;
const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8.5 5.5v13L19 12z" fill="currentColor"/></svg>';
const ICON_BIG = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_SMALL = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function defaultW() {
  const vw = window.innerWidth;
  return pip.big ? Math.min(vw - 2 * PIP_M, 720) : Math.max(200, Math.min(vw * 0.56, 360));
}

// 画面に収まる幅の範囲(高さも超えないように)
function widthLimits() {
  const byH = (window.innerHeight - 2 * PIP_M - (pip.big ? PIP_BAR : 0)) * 16 / 9;
  return { min: PIP_MIN_W, max: Math.max(PIP_MIN_W, Math.floor(Math.min(window.innerWidth - 2 * PIP_M, byH))) };
}

function pipDims() {
  const { min, max } = widthLimits();
  const w = Math.round(clamp(pip.size[pip.big ? 'big' : 'small'] || defaultW(), min, max));
  return { w, h: Math.round(w * 9 / 16) + (pip.big ? PIP_BAR : 0) };
}

function setSize(w) {
  pip.size[pip.big ? 'big' : 'small'] = Math.round(w);
  store.prefs.set('pipSize', pip.size);
}

function pipBounds() {
  const { w, h } = pipDims();
  return { minX: PIP_M, maxX: Math.max(PIP_M, window.innerWidth - w - PIP_M), minY: PIP_M, maxY: Math.max(PIP_M, window.innerHeight - h - PIP_M) };
}

// 画面の端より外へ引っぱったときは、ゴムのように少しだけついてくる
const rubber = (v, lo, hi) => (v < lo ? lo - (lo - v) * 0.3 : v > hi ? hi + (v - hi) * 0.3 : v);

function pipPlace(x, y, animate) {
  pip.x = x;
  pip.y = y;
  pip.el.style.transition = animate ? '' : 'none';
  pip.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  if (!animate) { void pip.el.offsetWidth; pip.el.style.transition = ''; }
}

function pipSavePos() {
  const b = pipBounds();
  pip.pos = {
    rx: b.maxX > b.minX ? (pip.x - b.minX) / (b.maxX - b.minX) : 1,
    ry: b.maxY > b.minY ? (pip.y - b.minY) / (b.maxY - b.minY) : 0,
  };
  store.prefs.set('pipPos', pip.pos);
}

// 覚えている位置(なければ右上)に置く
function pipRestore(animate) {
  if (pip.el.hidden) return;
  pip.el.classList.toggle('big', pip.big);
  pip.el.style.width = pipDims().w + 'px';
  const b = pipBounds();
  const p = pip.pos || { rx: 1, ry: 0.08 };
  pipPlace(b.minX + clamp(p.rx, 0, 1) * (b.maxX - b.minX), b.minY + clamp(p.ry, 0, 1) * (b.maxY - b.minY), animate);
}

function pipCommand(func, args = []) {
  if (pip.frame && pip.frame.contentWindow) {
    pip.frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  }
}

function paintPlay() {
  const b = pip.inner.querySelector('[data-pip="toggle"]');
  b.innerHTML = pip.playing ? ICON_PAUSE : ICON_PLAY;
  b.setAttribute('aria-label', pip.playing ? '一時停止' : '再生');
}

let ctrlTimer;
// タップで ⏸/▶・⤢・✕ を出して、2.6秒で消す
function showCtrls(ms = 2600) {
  pip.el.classList.add('ctrls');
  clearTimeout(ctrlTimer);
  ctrlTimer = setTimeout(() => pip.el.classList.remove('ctrls'), ms);
}
function hideCtrls() {
  clearTimeout(ctrlTimer);
  pip.el.classList.remove('ctrls');
}

function setPipBig(big) {
  const before = pip.inner.getBoundingClientRect();
  pip.big = big;
  hideCtrls();
  pipRestore(false);
  const after = pip.inner.getBoundingClientRect();
  pip.inner.animate([
    { transformOrigin: '0 0', transform: `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(${before.width / after.width}, ${before.height / after.height})` },
    { transformOrigin: '0 0', transform: 'none' },
  ], { duration: 420, easing: 'cubic-bezier(.32,.72,0,1)' });
}

function btn(cls, pipAct, label, svg) {
  const b = el('button', cls);
  b.type = 'button';
  b.dataset.pip = pipAct;
  b.setAttribute('aria-label', label);
  b.innerHTML = svg;
  return b;
}

// #pip の中身を作る(1回だけ)
function build() {
  pip.el = document.getElementById('pip');
  pip.inner = el('div', 'pip-inner');
  const bar = el('div', 'pip-bar');
  const grip = el('span', 'grip');
  grip.setAttribute('aria-hidden', 'true');
  pip.titleEl = el('span', 'pip-title');
  bar.append(grip, pip.titleEl, btn('pip-btn', 'small', '小さくする', ICON_SMALL), btn('pip-btn', 'close', '動画を閉じる', ui.ICON.close));
  const video = el('div', 'pip-video');
  pip.frameBox = el('div', 'pip-frame');
  // 小さいときは動画の上に透明な面を重ねて、どこを持っても動かせるようにする
  const shield = el('div', 'pip-shield');
  shield.append(
    btn('pip-ctl corner left', 'big', '大きくする', ICON_BIG),
    btn('pip-ctl corner right', 'close', '動画を閉じる', ui.ICON.close.replace('width="14" height="14"', 'width="16" height="16"')),
    btn('pip-ctl center', 'toggle', '一時停止', ICON_PAUSE),
  );
  video.append(pip.frameBox, shield);
  pip.inner.append(bar, video);
  pip.el.replaceChildren(pip.inner);
}

export function init() {
  build();
  pip.pos = store.prefs.get('pipPos', null);
  const sz = store.prefs.get('pipSize', null) || {};
  pip.size = { small: +sz.small > 0 ? +sz.small : 0, big: +sz.big > 0 ? +sz.big : 0 };

  pip.inner.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pip]');
    if (!b) return;
    const act = b.dataset.pip;
    if (act === 'close') closePip();
    else if (act === 'big') setPipBig(true);
    else if (act === 'small') setPipBig(false);
    else if (act === 'toggle') {
      pip.playing = !pip.playing;
      pipCommand(pip.playing ? 'playVideo' : 'pauseVideo');
      paintPlay();
      showCtrls();
    }
  });

  // 指(またはマウス)で動かす・2本指で大きさを変える。ほとんど動かさずに離したら「タップ」として操作ボタンを出す
  const fingers = new Map(); // pointerId → { x, y }
  let g = null; // 今の操作:{ kind: 'drag' | 'pinch' | 'idle', ... }。idle はピンチのあと指が残っている間

  const startDrag = () => {
    const [p] = fingers.values();
    g = { kind: 'drag', sx: p.x, sy: p.y, ox: pip.x, oy: pip.y, trail: [{ x: p.x, y: p.y, t: performance.now() }], b: pipBounds(), moved: false };
  };
  const moveDrag = (p) => {
    const dx = p.x - g.sx, dy = p.y - g.sy;
    if (!g.moved) {
      if (Math.hypot(dx, dy) < 6) return;
      g.moved = true;
      hideCtrls();
      pip.el.classList.add('dragging');
      pip.el.style.transition = 'none';
    }
    pip.x = rubber(g.ox + dx, g.b.minX, g.b.maxX);
    pip.y = rubber(g.oy + dy, g.b.minY, g.b.maxY);
    pip.el.style.transform = `translate3d(${pip.x}px, ${pip.y}px, 0)`;
    g.trail.push({ x: p.x, y: p.y, t: performance.now() });
    if (g.trail.length > 6) g.trail.shift();
  };
  const endDrag = () => {
    if (!g.moved) {
      if (!pip.big) {
        if (pip.el.classList.contains('ctrls')) hideCtrls(); else showCtrls();
      }
      return;
    }
    pip.el.classList.remove('dragging');
    pip.el.style.transition = '';
    // 指を離したときの勢いの分だけ滑らせてから止める
    const a = g.trail[0], z = g.trail[g.trail.length - 1];
    const dt = Math.max(16, z.t - a.t);
    const vx = (z.x - a.x) / dt, vy = (z.y - a.y) / dt;
    pipPlace(clamp(pip.x + vx * 140, g.b.minX, g.b.maxX), clamp(pip.y + vy * 140, g.b.minY, g.b.maxY), true);
    pipSavePos();
  };

  // ピンチしている2本の指の距離と真ん中
  const two = () => {
    const a = fingers.get(g.ids[0]), b = fingers.get(g.ids[1]);
    return { d: Math.hypot(b.x - a.x, b.y - a.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  // 2本目の指が触れたら、動かすのをやめて大きさを変えるモードへ。指の真ん中を中心に拡大・縮小する
  // 指を離すまでは transform だけで見せて(iframe を毎フレーム組み直さない)、離したときに本当の幅にする
  const startPinch = () => {
    pip.el.classList.remove('dragging');
    hideCtrls();
    const { w, h } = pipDims();
    g = { kind: 'pinch', ids: [...fingers.keys()].slice(0, 2), x0: pip.x, y0: pip.y, w0: w, h0: h, ...widthLimits() };
    const { d, mx, my } = two();
    Object.assign(g, { d0: Math.max(1, d), mx0: mx, my0: my });
    pip.el.classList.add('pinching');
    pip.el.style.transition = 'none';
    pip.inner.style.transition = 'none';
    pip.inner.style.transformOrigin = `${mx - pip.x}px ${my - pip.y}px`;
  };
  const movePinch = () => {
    const { d, mx, my } = two();
    const lo = g.min / g.w0, hi = g.max / g.w0;
    let s = d / g.d0;
    // 限界を超えたらゴムのように少しだけついてくる
    s = s < lo ? lo - (lo - s) * 0.3 : s > hi ? hi + (s - hi) * 0.3 : s;
    pip.inner.style.transform = `scale(${s})`;
    pip.el.style.transform = `translate3d(${g.x0 + mx - g.mx0}px, ${g.y0 + my - g.my0}px, 0)`;
  };
  const endPinch = () => {
    const r = pip.inner.getBoundingClientRect();
    pip.el.classList.remove('pinching');
    pip.inner.style.transform = '';
    pip.inner.style.transformOrigin = '';
    pip.inner.style.transition = '';
    setSize(clamp(r.width, g.min, g.max));
    const { w, h } = pipDims();
    pip.el.style.width = w + 'px';
    // 見えていた位置・大きさから、画面に収まる位置へなめらかに
    pipPlace(r.left, r.top, false);
    pip.inner.animate([
      { transformOrigin: '0 0', transform: `scale(${r.width / w}, ${r.height / h})` },
      { transformOrigin: '0 0', transform: 'none' },
    ], { duration: 350, easing: 'cubic-bezier(.32,.72,0,1)' });
    const b = pipBounds();
    pipPlace(clamp(r.left, b.minX, b.maxX), clamp(r.top, b.minY, b.maxY), true);
    pipSavePos();
    g = { kind: 'idle' };
  };

  pip.inner.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('button')) return;
    const target = e.target.closest('.pip-shield, .pip-bar');
    if (!target) return;
    e.preventDefault();
    try { target.setPointerCapture(e.pointerId); } catch { /* 合成イベントなど */ }
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 1) startDrag();
    else if (fingers.size === 2) startPinch();
  });
  pip.inner.addEventListener('pointermove', (e) => {
    const p = fingers.get(e.pointerId);
    if (!p || !g) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (g.kind === 'drag') moveDrag(p);
    else if (g.kind === 'pinch') movePinch();
  });
  const lift = (e) => {
    if (!g || !fingers.has(e.pointerId)) return;
    if (g.kind === 'pinch') { if (g.ids.includes(e.pointerId)) endPinch(); }
    else if (g.kind === 'drag') { endDrag(); g = { kind: 'idle' }; }
    fingers.delete(e.pointerId);
    if (!fingers.size) g = null;
  };
  pip.inner.addEventListener('pointerup', lift);
  pip.inner.addEventListener('pointercancel', lift);

  // トラックパッドのピンチ(ctrl+ホイールとして届く)でも大きさを変える。真ん中を固定して拡大・縮小
  let wheelSave;
  pip.el.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || pip.el.hidden || g) return;
    e.preventDefault();
    const { w, h } = pipDims();
    const { min, max } = widthLimits();
    const nw = Math.round(clamp(w * Math.exp(-e.deltaY * 0.01), min, max));
    if (nw === w) return;
    setSize(nw);
    const d = pipDims();
    pip.el.style.width = d.w + 'px';
    const b = pipBounds();
    pipPlace(clamp(pip.x - (d.w - w) / 2, b.minX, b.maxX), clamp(pip.y - (d.h - h) / 2, b.minY, b.maxY), false);
    clearTimeout(wheelSave);
    wheelSave = setTimeout(pipSavePos, 300);
  }, { passive: false });

  // YouTube から再生状態を受け取る(1=再生中, 3=読み込み中)
  window.addEventListener('message', (e) => {
    if (!pip.frame || e.source !== pip.frame.contentWindow) return;
    let d;
    try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    if (!d) return;
    const st = d.event === 'onStateChange' ? d.info : d.info && d.info.playerState;
    if (typeof st === 'number' && st !== -1) {
      pip.playing = st === 1 || st === 3;
      paintPlay();
    }
  });

  let resizeRaf;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => pipRestore(false));
  });

  // 再生中のレシピが消えたら(ゴミ箱へ・ほかの端末で削除)小窓も閉じる。ボックスの切り替えでも閉じる
  store.on('recipes', ({ removed }) => {
    if (pip.recipeId && (removed.includes(pip.recipeId) || !store.recipes.get(pip.recipeId))) closePip();
  });
}

// 小窓で再生する。同じ動画なら頭出しだけ。origin(押したボタン)からふくらんで出てくる
export function openPip(r, t = 0, origin) {
  const v = videoInfo(r.videoUrl);
  if (!v || v.type !== 'youtube') return;
  if (pip.vid === v.id && !pip.el.hidden) {
    pipCommand('seekTo', [t, true]);
    pipCommand('playVideo');
    pip.playing = true;
    paintPlay();
    replay(pip.el, 'flash');
    return;
  }
  pip.vid = v.id;
  pip.recipeId = r.id;
  pip.playing = true;
  paintPlay();
  pip.titleEl.textContent = r.name;
  const f = document.createElement('iframe');
  f.title = r.name;
  // allowfullscreen 属性は allow の fullscreen と重なって警告が出るので、allow だけにする
  f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  // youtube-nocookie はログイン情報を使わない(=ゲスト扱いで広告が出る)ので、通常の youtube.com で埋め込む
  f.src = `https://www.youtube.com/embed/${v.id}?autoplay=1&playsinline=1&rel=0&enablejsapi=1`
    + `&origin=${encodeURIComponent(location.origin)}&start=${Math.floor(t)}`;
  f.addEventListener('load', () => {
    f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
  });
  pip.frameBox.replaceChildren(f);
  pip.frame = f;

  const wasHidden = pip.el.hidden;
  pip.el.hidden = false;
  pipRestore(false);
  if (wasHidden) {
    // 押したボタンの位置から小窓が飛び出すように
    const { w, h } = pipDims();
    let from = 'translateY(30px) scale(.7)';
    if (origin && origin.getBoundingClientRect) {
      const o = origin.getBoundingClientRect();
      const dx = o.left + o.width / 2 - (pip.x + w / 2);
      const dy = o.top + o.height / 2 - (pip.y + h / 2);
      from = `translate(${dx}px, ${dy}px) scale(.2)`;
    }
    pip.inner.animate(
      [{ transform: from, opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 600, easing: 'cubic-bezier(.2,1.1,.3,1)' }
    );
    // 最初だけ操作ボタンを見せて、触れることを伝える
    if (!pip.big) setTimeout(() => showCtrls(1800), 450);
  }
}

export function closePip() {
  if (!pip.el || pip.el.hidden || !pip.frame) return;
  hideCtrls();
  const f = pip.frame;
  pip.frame = null;
  pip.vid = null;
  pip.recipeId = null;
  pip.inner.animate(
    [{ transform: 'none', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }],
    { duration: 240, easing: 'cubic-bezier(.4,0,1,1)' }
  ).onfinish = () => {
    if (pip.frame) return; // 閉じている間に次の動画が開いた
    pip.el.hidden = true;
    f.remove();
  };
}
