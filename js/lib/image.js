// 写真の圧縮と、画像要素の生成(v1 の app.js から移植)
import { videoInfo } from './video.js';

// 同期の上限に収まるよう、大きすぎる写真は画質と大きさを段階的に下げる(data URL を返す)
export async function compressImage(file, max = 1400, quality = 0.84, limit = 450000) {
  let out = await drawImage(file, max, quality);
  for (const [m, q] of [[max, 0.72], [1000, 0.7], [800, 0.65]]) {
    if (out.length <= limit) break;
    out = await drawImage(file, m, q);
  }
  return out;
}

export async function drawImage(file, max, quality) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    src = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width || src.naturalWidth;
  const h = src.height || src.naturalHeight;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// 読み込みが終わると .loaded が付く img(ふわっと表示するのに使う)
export function makeImg(src, cls) {
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  if (cls) img.className = cls;
  img.onload = () => img.classList.add('loaded');
  img.src = src;
  return img;
}

// レシピの代表画像:写真 → 無ければ YouTube のサムネイル(.yt 付き)→ 無ければ null
export function heroImage(r, cls) {
  if (r.photo) return makeImg(r.photo, cls);
  const v = videoInfo(r.videoUrl);
  if (v && v.thumb) {
    const img = makeImg(v.thumb, ((cls || '') + ' yt').trim());
    img.referrerPolicy = 'no-referrer';
    return img;
  }
  return null;
}
