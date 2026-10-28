// Firebase SDK(10.12.2、gstatic の ES modules)の薄い層。設定値(window.RB2_FIREBASE_CONFIG)が無ければ何も読み込まない
// 使うのは store.js だけ。init() が返す「クラウド API」の形は、動作確認用の偽クラウドでも同じにする
const CDN = 'https://www.gstatic.com/firebasejs/10.12.2/';

export const hasCloud = typeof window !== 'undefined' && !!window.RB2_FIREBASE_CONFIG;

// 読み込みと初期化。設定が無ければ null
export async function init() {
  const cfg = typeof window !== 'undefined' ? window.RB2_FIREBASE_CONFIG : null;
  if (!cfg) return null;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${CDN}firebase-app.js`),
    import(`${CDN}firebase-auth.js`),
    import(`${CDN}firebase-firestore.js`),
  ]);
  const app = initializeApp(cfg);
  const auth = A.getAuth(app);
  // 端末内にもキャッシュするので、電波がなくても読み書きでき、つながったときに同期される
  const fs = F.initializeFirestore(app, {
    localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
  });
  // ボックス(ownerUid)の下のコレクション・ドキュメント
  const col = (ownerUid, name) => F.collection(fs, 'users', ownerUid, name);
  const docOf = (ownerUid, name, id) => F.doc(fs, 'users', ownerUid, name, id);
  const changesOf = (snap) => snap.docChanges().map((c) => ({ type: c.type, id: c.doc.id, data: c.doc.data() }));
  // 献立は直近60日より前のものは読まない(年単位で増えても軽いまま)
  const since = () => new Date(Date.now() - 60 * 864e5).toLocaleDateString('sv-SE');

  return {
    uid: () => (auth.currentUser ? auth.currentUser.uid : null),

    /* ---- ログイン ---- */
    // cb({ uid, name, email, photo } | null)。戻り値は解除関数
    onAuth(cb) {
      return A.onAuthStateChanged(auth, (u) => cb(u
        ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' }
        : null));
    },
    // ポップアップが使えない環境(TWA など)はリダイレクトに切り替える
    async signIn() {
      const provider = new A.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await A.signInWithPopup(auth, provider);
      } catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
          await A.signInWithRedirect(auth, provider);
        } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
          throw e;
        }
      }
    },
    signOut: () => A.signOut(auth),

    /* ---- 購読(ボックス = ownerUid 単位)。戻り値は解除関数 ---- */
    // onData({ changes:[{type,id,data}], fromCache, pending })
    watchRecipes(ownerUid, onData, onError) {
      return F.onSnapshot(col(ownerUid, 'recipes'), { includeMetadataChanges: true }, (snap) => onData({
        changes: changesOf(snap), fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites,
      }), onError);
    },
    // name: 'plan' | 'shopping' | 'members'。onData([{type,id,data}])
    watchCollection(ownerUid, name, onData, onError) {
      const q = name === 'plan' ? F.query(col(ownerUid, 'plan'), F.where('date', '>=', since())) : col(ownerUid, name);
      return F.onSnapshot(q, (snap) => onData(changesOf(snap)), onError);
    },
    // onData(data | null)。キャッシュから「無い」と言われただけのときは呼ばない(サーバーの答えを待つ)
    watchSettings(ownerUid, onData, onError) {
      return F.onSnapshot(docOf(ownerUid, 'meta', 'settings'), (snap) => {
        if (!snap.metadata.fromCache || snap.exists()) onData(snap.exists() ? snap.data() : null);
      }, onError);
    },
    // 参加しているボックス(本人だけ)。onData(boxes[], fromCache)
    watchBoxes(uid, onData, onError) {
      return F.onSnapshot(docOf(uid, 'meta', 'boxes'), (snap) => {
        const d = snap.exists() ? snap.data() : null;
        onData(d && Array.isArray(d.boxes) ? d.boxes : [], snap.metadata.fromCache);
      }, onError);
    },

    /* ---- 書き込み(Promise を返す。オフラインだと解決しないので、store は待たずに投げっぱなしにする) ---- */
    put: (ownerUid, name, d) => F.setDoc(docOf(ownerUid, name, d.id), d),
    del: (ownerUid, name, id) => F.deleteDoc(docOf(ownerUid, name, id)),
    putSettings: (ownerUid, data) => F.setDoc(docOf(ownerUid, 'meta', 'settings'), data),
    setBoxes: (uid, boxes) => F.setDoc(docOf(uid, 'meta', 'boxes'), { boxes }),
    // 献立・買い物リストはまとめて書く。1回の上限が500件なので450件ずつに分ける
    batch(ownerUid, name, ops) {
      const jobs = [];
      for (let i = 0; i < ops.length; i += 450) {
        const b = F.writeBatch(fs);
        ops.slice(i, i + 450).forEach((op) => {
          const ref = docOf(ownerUid, name, op.type === 'del' ? op.id : op.d.id);
          if (op.type === 'del') b.delete(ref); else b.set(ref, op.d);
        });
        jobs.push(b.commit());
      }
      return Promise.all(jobs);
    },

    /* ---- 招待・メンバー(こちらはサーバーの答えを待つ) ---- */
    createInvite: (code, data) => F.setDoc(F.doc(fs, 'invites', code), data),
    async getInvite(code) {
      const s = await F.getDoc(F.doc(fs, 'invites', code));
      return s.exists() ? s.data() : null;
    },
    deleteInvite: (code) => F.deleteDoc(F.doc(fs, 'invites', code)),
    async listInvites(uid) {
      const s = await F.getDocs(F.query(F.collection(fs, 'invites'), F.where('ownerUid', '==', uid)));
      return s.docs.map((d) => ({ code: d.id, ...d.data() }));
    },
    addMember: (ownerUid, memberUid, data) => F.setDoc(docOf(ownerUid, 'members', memberUid), data),
    removeMember: (ownerUid, memberUid) => F.deleteDoc(docOf(ownerUid, 'members', memberUid)),
  };
}
