// ボックス(共有):上部バーの切り替えメニュー、コードで参加、招待コードの発行と共有、メンバー一覧と外す/退出、
// 設定の「ボックスと共有」の中身(buildBoxPanel)。データの処理は store(joinBox / createInvite / leaveBox / removeMember)
// ログインしていないときは、どの画面も「ログインすると使えます」の案内になる
import { store } from './store.js';
import * as ui from './ui.js';
import { el, fmtDate } from './lib/text.js';

const APP_URL = 'https://ygfoster.github.io/Recipe-Box-2/';
const signedIn = () => store.mode === 'cloud' && !!store.user;
const dayOf = (ms) => new Date(ms).toLocaleDateString('sv-SE');
const initial = (s) => (s || '?').trim().charAt(0).toUpperCase() || '?';
const NET_TEXT = 'インターネットにつながっていないようです。接続を確認してください';

let joinOv = null, inviteOv = null;
let panel = null; // 設定の「ボックスと共有」(作られていれば)
const j = {}; // 参加シートの部品
const v = {}; // 招待コードのシートの部品

export function init() {
  ensureSheets();
  // ログイン状態やボックスが変わったら、開いている画面を描き直す
  store.on('auth', () => { if (ui.isOpen(joinOv)) renderJoin(); if (panel) { panel.render(); panel.loadInvites(); } });
  ['box', 'boxes', 'members', 'settings', 'sync'].forEach((ev) => store.on(ev, () => { if (panel) panel.render(); }));
  store.on('box', () => { if (panel) panel.loadInvites(); });
}

// store のエラーを利用者向けの文に
function errText(e, fallback) {
  const code = (e && e.code) || '';
  if (code === 'not-signed-in') return 'ログインすると使えます';
  if (code === 'network' || code === 'unavailable') return NET_TEXT;
  if (code === 'permission-denied') return `${fallback}(権限がありません。セキュリティルールを確認してください)`;
  return `${fallback}(${code || 'unknown'})`;
}

// 丸いアイコンに、写真 → 名前の頭文字 → 人の形、の順で描く
export function paintAvatar(node, user) {
  node.innerHTML = '';
  if (user && user.photo) {
    const img = new Image();
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => { node.textContent = initial(user.name || user.email); };
    img.src = user.photo;
    node.append(img);
  } else if (user && (user.name || user.email)) {
    node.textContent = initial(user.name || user.email);
  } else {
    node.innerHTML = ui.ICON.person;
  }
}

// Google でログイン(ボタンの文字を変えて待つ。失敗は通知)
async function signInWith(btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'ログインしています…';
  try {
    await store.signIn();
  } catch (e) {
    ui.toast(store.signInErrorText(e));
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// 「ログインすると使えます」の案内
function lockedBlock(text) {
  const box = el('div', 'share-locked');
  const icon = el('span', 'share-locked-icon');
  icon.innerHTML = ui.ICON.person;
  box.append(icon, el('b', null, 'ログインすると使えます'), el('p', null, text));
  if (store.hasCloud) {
    const b = el('button', 'btn primary', 'Google でログイン');
    b.type = 'button';
    b.onclick = () => signInWith(b);
    box.append(b);
  }
  return box;
}

/* ---------------- 上部バーの「ボックス名 ▾」 ---------------- */
export function openBoxMenu(anchor) {
  const items = [{ header: 'ボックス' }];
  if (!signedIn()) {
    items.push({ label: 'マイボックス', sub: 'この端末だけに保存', selected: true });
    items.push({ sep: true });
    items.push({ label: 'コードで参加', sub: 'ログインすると使えます', icon: ui.ICON.plus, onSelect: openJoin });
  } else {
    store.boxes.forEach((b) => items.push({
      label: b.name,
      sub: b.isMine ? 'あなたのボックス' : b.ownerName ? `${b.ownerName}さんのボックス` : '参加しているボックス',
      selected: b.ownerUid === store.box.ownerUid,
      onSelect: () => { if (b.ownerUid !== store.box.ownerUid) store.switchBox(b.ownerUid); },
    }));
    items.push({ sep: true });
    items.push({ label: 'コードで参加', sub: '招待コードでほかのボックスに参加', icon: ui.ICON.plus, onSelect: openJoin });
  }
  ui.menu(anchor, items, { align: 'left' });
}

/* ---------------- コードで参加(シート) ---------------- */
function ensureSheets() {
  if (joinOv) return;
  joinOv = ui.sheet({ id: 'join', title: 'コードで参加', eyebrow: 'ボックスに参加', build: buildJoin });
  inviteOv = ui.sheet({ id: 'invite', title: '招待コード', eyebrow: '', build: buildInvite });
}

function buildJoin(body) {
  body.innerHTML = `
    <div data-locked hidden></div>
    <form class="join-form" novalidate>
      <p class="hint">家族や友だちから受け取った、6文字の招待コードを入力してください。参加すると、そのボックスのレシピ・献立・買い物リストを一緒に使えます。</p>
      <div>
        <label class="lbl" for="joinCode">招待コード</label>
        <input class="join-input" id="joinCode" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" aria-describedby="joinError">
      </div>
      <p class="join-error" id="joinError" role="alert" hidden></p>
      <button class="btn primary wide" type="submit">参加する</button>
    </form>`;
  j.locked = body.querySelector('[data-locked]');
  j.form = body.querySelector('form');
  j.input = body.querySelector('input');
  j.error = body.querySelector('.join-error');
  j.submit = body.querySelector('button[type="submit"]');
  j.input.addEventListener('input', () => {
    // 大文字と数字だけにそろえる(ハイフンや空白は無視)
    const s = j.input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (s !== j.input.value) j.input.value = s;
    j.error.hidden = true;
    j.input.classList.remove('invalid');
  });
  j.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!signedIn()) return renderJoin();
    j.submit.disabled = true;
    j.submit.textContent = '参加しています…';
    j.error.hidden = true;
    try {
      const box = await store.joinBox(j.input.value);
      ui.close(joinOv);
      // 相手が付けたボックス名は設定の読み込み後に届くので、少し待ってから今の名前で知らせる
      setTimeout(() => {
        const cur = store.box.ownerUid === box.ownerUid ? store.box : box;
        ui.toast(`「${cur.name}」に参加しました`);
      }, 400);
    } catch (err) {
      if (err && err.code === 'not-signed-in') { renderJoin(); return; }
      j.error.textContent = store.joinErrorText(err);
      j.error.hidden = false;
      j.input.classList.remove('invalid');
      void j.input.offsetWidth;
      j.input.classList.add('invalid');
      j.input.focus();
    } finally {
      j.submit.disabled = false;
      j.submit.textContent = '参加する';
    }
  });
}

function renderJoin() {
  const on = signedIn();
  j.locked.innerHTML = '';
  if (!on) j.locked.append(lockedBlock('家族や友だちのボックスに参加するには、Google でログインしてください。'));
  j.locked.hidden = on;
  j.form.hidden = !on;
}

export function openJoin() {
  ensureSheets();
  j.input.value = '';
  j.error.hidden = true;
  j.input.classList.remove('invalid');
  renderJoin();
  ui.open(joinOv);
  if (signedIn() && matchMedia('(min-width: 641px)').matches) setTimeout(() => j.input.focus(), 400);
}

/* ---------------- 招待コード(発行したコードを見せて、共有・コピー) ---------------- */
function buildInvite(body) {
  body.innerHTML = `
    <p class="hint">このコードを家族や友だちに送ってください。相手がアプリの「コードで参加」に入力すると、このボックスのレシピ・献立・買い物リストを一緒に使えます。</p>
    <div class="invite-code"><b data-code></b><span data-exp></span></div>
    <div class="invite-actions">
      <button class="btn primary" type="button" data-share>${ui.ICON.share}共有</button>
      <button class="btn" type="button" data-copy>コピー</button>
    </div>`;
  v.code = body.querySelector('[data-code]');
  v.exp = body.querySelector('[data-exp]');
  v.share = body.querySelector('[data-share]');
  v.copy = body.querySelector('[data-copy]');
  v.share.onclick = () => shareInvite(v.current);
  v.copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(v.current.code);
      ui.toast('招待コードをコピーしました');
    } catch {
      ui.toast('コピーできませんでした');
    }
  };
}

function openInvite(inv) {
  ensureSheets();
  v.current = inv;
  inviteOv.setTitle('招待コード', `「${store.box.name}」に招待`);
  v.code.textContent = inv.code;
  v.exp.textContent = `${fmtDate(dayOf(inv.expiresAt))}まで有効`;
  ui.open(inviteOv);
}

function inviteText(inv) {
  return [
    `レシピボックス「${store.box.name}」への招待コード:${inv.code}`,
    `(${fmtDate(dayOf(inv.expiresAt))}まで有効)`,
    '',
    `アプリ ${APP_URL} を開いて Google でログインし、左上の「ボックス名 ▾」→「コードで参加」にこのコードを入力してください。`,
  ].join('\n');
}

async function shareInvite(inv) {
  const text = inviteText(inv);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'レシピボックスへの招待', text });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 共有シートを閉じただけ
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    ui.toast('招待の文をコピーしました。LINE などに貼り付けて送れます');
  } catch {
    ui.toast('共有できませんでした');
  }
}

/* ---------------- 設定の「ボックスと共有」 ---------------- */
// container に中身を作り、{ render, show, loadInvites } を返す。isVisible() は画面に出ているか(招待一覧の取得に使う)
export function buildBoxPanel(container, isVisible = () => true) {
  container.innerHTML = `
    <div data-locked hidden></div>
    <div class="box-panel" data-panel hidden>
      <div class="box-notice" data-notice hidden></div>
      <section class="sec">
        <h3 class="sec-h">今のボックス</h3>
        <div class="box-card">
          <b class="box-card-name" data-name></b>
          <span class="box-card-owner" data-owner></span>
          <form class="box-name-form" data-name-form novalidate>
            <label class="lbl" for="boxNameInput">ボックスの名前</label>
            <div class="add-row">
              <input id="boxNameInput" maxlength="30" autocomplete="off" enterkeyhint="done" placeholder="マイボックス">
              <button class="btn small" type="submit">保存</button>
            </div>
            <p class="hint">メンバーの画面にも同じ名前で表示されます。空にすると「◯◯のレシピ」に戻ります。</p>
          </form>
          <div class="box-leave" data-leave-wrap hidden>
            <p class="hint">退出すると、このボックスのレシピは見られなくなります。もう一度参加するには新しい招待コードが必要です。</p>
            <button class="btn danger" type="button" data-leave>このボックスから退出</button>
          </div>
        </div>
      </section>
      <section class="sec">
        <div class="sec-h-row"><h3 class="sec-h">メンバー</h3><span class="sec-count" data-member-count></span></div>
        <ul class="list member-list" data-members></ul>
        <p class="hint" data-members-hint hidden></p>
      </section>
      <section class="sec" data-invite-sec hidden>
        <h3 class="sec-h">招待</h3>
        <p class="hint">招待コードを発行して LINE などで渡すと、相手が自分のアプリから参加できます。コードは7日間有効です。</p>
        <button class="btn primary" type="button" data-create>${ui.ICON.plus}招待コードを発行</button>
        <ul class="list invite-list" data-invites hidden></ul>
      </section>
      <section class="sec">
        <h3 class="sec-h">ほかのボックスに参加</h3>
        <button class="btn" type="button" data-join>コードで参加</button>
      </section>
    </div>`;
  const q = (sel) => container.querySelector(sel);
  const p = {
    locked: q('[data-locked]'), panel: q('[data-panel]'), notice: q('[data-notice]'),
    name: q('[data-name]'), owner: q('[data-owner]'), nameForm: q('[data-name-form]'), nameInput: q('#boxNameInput'),
    leaveWrap: q('[data-leave-wrap]'), leave: q('[data-leave]'),
    memberCount: q('[data-member-count]'), members: q('[data-members]'), membersHint: q('[data-members-hint]'),
    inviteSec: q('[data-invite-sec]'), create: q('[data-create]'), invites: q('[data-invites]'), join: q('[data-join]'),
  };
  let invites = []; // 自分が発行した有効な招待
  let inviteSeq = 0;
  let leaveTimer = 0;

  p.nameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!signedIn() || !store.box.isMine) return;
    const name = p.nameInput.value.trim().replace(/\s+/g, ' ');
    if (name === (store.settings.boxName || '')) return ui.toast('ボックスの名前は変わっていません');
    if (await store.settings.save({ boxName: name })) ui.toast(name ? `ボックスの名前を「${name}」にしました` : 'ボックスの名前を元に戻しました');
  });

  // 退出は取り消せないので2段階(3秒で戻る)
  p.leave.addEventListener('click', async () => {
    const box = store.box;
    if (!signedIn() || box.isMine) return;
    if (!p.leave.classList.contains('confirm')) {
      p.leave.classList.add('confirm');
      p.leave.textContent = '本当に退出する';
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => { p.leave.classList.remove('confirm'); p.leave.textContent = 'このボックスから退出'; }, 3000);
      return;
    }
    clearTimeout(leaveTimer);
    p.leave.disabled = true;
    try {
      await store.leaveBox(box.ownerUid);
      ui.toast(`「${box.name}」から退出しました`);
    } catch (err) {
      ui.toast(errText(err, '退出できませんでした'));
    } finally {
      p.leave.disabled = false;
      p.leave.classList.remove('confirm');
      p.leave.textContent = 'このボックスから退出';
    }
  });

  p.create.addEventListener('click', async () => {
    p.create.disabled = true;
    const label = p.create.innerHTML;
    p.create.textContent = '発行しています…';
    try {
      const inv = await store.createInvite();
      invites = [inv, ...invites.filter((x) => x.code !== inv.code)];
      renderInvites();
      openInvite(inv);
    } catch (err) {
      ui.toast(errText(err, '招待コードを発行できませんでした'));
    } finally {
      p.create.disabled = false;
      p.create.innerHTML = label;
    }
  });
  p.join.addEventListener('click', openJoin);

  function render() {
    const on = signedIn();
    p.locked.innerHTML = '';
    if (!on) p.locked.append(lockedBlock('家族や友だちと同じレシピ帳を使うには、Google でログインしてください。招待コードの発行や参加ができるようになります。'));
    p.locked.hidden = on;
    p.panel.hidden = !on;
    if (!on) { invites = []; return; }
    const box = store.box;
    const me = store.user;
    // 自分のボックスで権限エラーが出ているとき(セキュリティルール未設定など)は、ここでも知らせる
    const err = store.sync.state === 'error' ? store.sync.error : '';
    p.notice.textContent = err ? `同期できませんでした:${err}` : '';
    p.notice.hidden = !err;

    p.name.textContent = box.name;
    p.owner.textContent = box.isMine ? 'あなたのボックス' : box.ownerName ? `${box.ownerName}さんのボックス` : '参加しているボックス';
    p.nameForm.hidden = !box.isMine;
    p.leaveWrap.hidden = box.isMine;
    if (box.isMine) {
      p.nameInput.placeholder = me.name ? `${me.name}のレシピ` : 'マイボックス';
      if (document.activeElement !== p.nameInput) p.nameInput.value = store.settings.boxName || '';
    }
    renderMembers();
    p.inviteSec.hidden = !box.isMine;
    renderInvites();
  }

  function memberRow(user, { tag, removable } = {}) {
    const li = el('li');
    const av = el('span', 'avatar');
    paintAvatar(av, user);
    const text = el('span', 'mb-text');
    text.append(el('b', null, user.name || 'メンバー'));
    if (user.sub) text.append(el('span', null, user.sub));
    li.append(av, text);
    if (tag) li.append(el('span', 'mb-tag', tag));
    if (removable) {
      // 外すのも2段階(3秒で戻る)
      const b = el('button', 'mb-remove', '外す');
      b.type = 'button';
      b.setAttribute('aria-label', `「${user.name || 'メンバー'}」をボックスから外す`);
      let t = 0;
      b.onclick = async () => {
        if (!b.classList.contains('confirm')) {
          b.classList.add('confirm');
          b.textContent = '本当に外す';
          t = setTimeout(() => { if (b.isConnected) { b.classList.remove('confirm'); b.textContent = '外す'; } }, 3000);
          return;
        }
        clearTimeout(t);
        b.disabled = true;
        try {
          await store.removeMember(user.uid);
          ui.toast(`「${user.name || 'メンバー'}」を外しました`);
        } catch (err) {
          ui.toast(errText(err, '外せませんでした'));
          b.disabled = false;
          b.classList.remove('confirm');
          b.textContent = '外す';
        }
      };
      li.append(b);
    }
    return li;
  }

  function renderMembers() {
    const box = store.box;
    const me = store.user;
    p.members.innerHTML = '';
    const owner = box.isMine ? { ...me, sub: me.email } : { name: box.ownerName, photo: '' };
    p.members.append(memberRow(owner, { tag: 'オーナー' }));
    store.members.forEach((m) => {
      const mine = m.uid === me.uid;
      const sub = m.joinedAt ? `${fmtDate(dayOf(m.joinedAt))}に参加` : '';
      p.members.append(memberRow({ ...m, sub }, { tag: mine ? 'あなた' : '', removable: box.isMine && !mine }));
    });
    const n = store.members.length;
    p.memberCount.textContent = n ? `${n + 1}人` : '';
    const hint = !store.loaded ? ''
      : !n && box.isMine ? 'まだメンバーはいません。招待コードを発行して渡すと、相手が参加できます。'
        : !n ? 'ほかのメンバーはいません。' : '';
    p.membersHint.textContent = hint;
    p.membersHint.hidden = !hint;
  }

  function renderInvites() {
    p.invites.innerHTML = '';
    const now = Date.now();
    const alive = invites.filter((inv) => +inv.expiresAt > now);
    alive.forEach((inv) => {
      const li = el('li');
      const open = el('button', 'iv-open');
      open.type = 'button';
      open.setAttribute('aria-label', `招待コード ${inv.code} を見る`);
      const left = Math.max(0, Math.ceil((inv.expiresAt - now) / 864e5));
      open.append(el('b', 'iv-code', inv.code), el('span', 'iv-exp', left <= 1 ? '今日まで' : `あと${left}日`));
      open.onclick = () => openInvite(inv);
      const del = el('button', 'link small iv-del', '取り消す');
      del.type = 'button';
      del.onclick = async () => {
        del.disabled = true;
        try {
          await store.deleteInvite(inv.code);
          invites = invites.filter((x) => x.code !== inv.code);
          renderInvites();
          ui.toast(`招待コード ${inv.code} を取り消しました`);
        } catch (err) {
          del.disabled = false;
          ui.toast(errText(err, '取り消せませんでした'));
        }
      };
      li.append(open, del);
      p.invites.append(li);
    });
    p.invites.hidden = !alive.length;
  }

  // 自分が発行した招待を取り直す(期限切れは静かに片づける)。画面に出ているときだけ
  async function loadInvites() {
    if (!signedIn() || !store.box.isMine || !isVisible()) return;
    const seq = ++inviteSeq;
    try {
      const list = await store.listInvites();
      if (seq !== inviteSeq || !signedIn() || !store.box.isMine) return;
      const now = Date.now();
      list.filter((inv) => !(+inv.expiresAt > now)).forEach((inv) => store.deleteInvite(inv.code).catch(() => {}));
      invites = list.filter((inv) => +inv.expiresAt > now).sort((a, b) => (+b.createdAt || 0) - (+a.createdAt || 0));
      renderInvites();
    } catch {
      /* 取れなくても発行はできる。一覧は次に開いたときに取り直す */
    }
  }

  panel = { render, loadInvites, show() { render(); loadInvites(); } };
  render();
  return panel;
}
