import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect,
  signOut, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyA_Q5SQDpLVckk8Zpf8nZ6GUAaQAlX088k',
  authDomain: 'taidt-904f7.firebaseapp.com',
  projectId: 'taidt-904f7',
  storageBucket: 'taidt-904f7.firebasestorage.app',
  messagingSenderId: '452970394234',
  appId: '1:452970394234:web:46ad16dcbb51baacacc1c3',
  measurementId: 'G-G7ECBCRMJN'
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const CLOUD_KEY = 'order_cloud_v15';
const LOGIN_FLAG = 'v44_workspace_login_done';
const LOGIN_KEY = 'v44_workspace_login_key';
const GOOGLE_UID = 'order_google_uid_v48';
const GOOGLE_EMAIL = 'order_google_email_v48';
const LEGACY_KEYS = ['workspace_login_key','v43_workspace_login_key','v39_workspace_login_key','v38_workspace_login_key'];
const LEGACY_FLAGS = ['workspace_login_done','v43_workspace_login_done','v39_workspace_login_done','v38_workspace_login_done'];
let currentUser = null;
let authBooted = false;
let accountPanel = null;

function qs(s){ return document.querySelector(s); }
function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function profileName(user){ return user?.displayName || user?.email?.split('@')[0] || 'Tài khoản Google'; }
function localWorkspaceKey(user){ return 'google-' + String(user?.uid || '').toLowerCase().replace(/[^a-z0-9_-]/g,''); }
function isGoogleUser(user){ return !!user && !user.isAnonymous && (user.providerData || []).some(p=>p.providerId === 'google.com'); }
function userDoc(user=currentUser){ if(!user) throw new Error('Bạn chưa đăng nhập Google.'); return doc(db,'orderDashboards',user.uid); }
function toastSafe(msg){ try{ if(typeof window.toast === 'function') window.toast(msg); }catch(e){} }

function createLogin(){
  let el=qs('#g48AuthOverlay');
  if(el) return el;
  el=document.createElement('div');
  el.id='g48AuthOverlay'; el.className='g48AuthOverlay';
  el.innerHTML=`<div class="g48AuthCard" role="dialog" aria-modal="true" aria-labelledby="g48AuthTitle">
    <div class="g48AuthLogo">G</div>
    <h2 id="g48AuthTitle">Đăng nhập để sử dụng</h2>
    <p>Dữ liệu đơn hàng, tháng, đánh giá và giải pháp sẽ được lưu riêng theo tài khoản Google của bạn và đồng bộ Cloud theo thời gian thực.</p>
    <button type="button" class="g48GoogleBtn" id="g48GoogleBtn"><span class="g48GoogleG">G</span><span>Tiếp tục với Google</span></button>
    <div class="g48AuthHint">Mỗi tài khoản Google có vùng dữ liệu riêng. Đăng nhập cùng tài khoản trên thiết bị khác để tiếp tục dữ liệu.</div>
    <div class="g48AuthError" id="g48AuthError"></div>
  </div>`;
  document.body.appendChild(el);
  qs('#g48GoogleBtn').addEventListener('click',loginGoogle);
  return el;
}
function showLogin(message=''){
  const el=createLogin(); el.classList.add('show');
  const err=qs('#g48AuthError');
  if(err){err.textContent=message;err.classList.toggle('show',!!message);}
}
function hideLogin(){ qs('#g48AuthOverlay')?.classList.remove('show'); }

async function loginGoogle(){
  const btn=qs('#g48GoogleBtn'); const err=qs('#g48AuthError');
  if(btn) btn.disabled=true; if(err) err.classList.remove('show');
  try{
    await setPersistence(auth,browserLocalPersistence);
    await signInWithPopup(auth,provider);
  }catch(e){
    if(['auth/popup-blocked','auth/operation-not-supported-in-this-environment'].includes(e?.code)){
      try{ await signInWithRedirect(auth,provider); return; }catch(e2){ e=e2; }
    }
    if(e?.code !== 'auth/popup-closed-by-user'){
      const msg=e?.code==='auth/unauthorized-domain'
        ? 'Tên miền hiện tại chưa được thêm vào Firebase Authentication → Settings → Authorized domains.'
        : (e?.message || 'Không thể đăng nhập Google.');
      if(err){err.textContent=msg;err.classList.add('show');}
    }
  }finally{ if(btn) btn.disabled=false; }
}

function writeAccountScope(user){
  const key=localWorkspaceKey(user);
  let old={}; try{old=JSON.parse(localStorage.getItem(CLOUD_KEY)||'{}')||{};}catch(e){}
  localStorage.setItem(CLOUD_KEY,JSON.stringify({key,pass:'',auto:true,lastSync:old.lastSync||'',provider:'firebase-google'}));
  localStorage.setItem(LOGIN_FLAG,'1'); localStorage.setItem(LOGIN_KEY,key);
  localStorage.setItem('workspace_login_done','1'); localStorage.setItem('workspace_login_key',key);
  LEGACY_FLAGS.forEach(k=>localStorage.setItem(k,'1')); LEGACY_KEYS.forEach(k=>localStorage.setItem(k,key));
  localStorage.setItem(GOOGLE_UID,user.uid); localStorage.setItem(GOOGLE_EMAIL,user.email||'');
  try{ if(typeof window.v46LoadWorkspaceLocal==='function') window.v46LoadWorkspaceLocal(key); }catch(e){console.warn('load local account scope',e);}
  return key;
}

function installCloud(user){
  window.firebaseCloud={
    async save(_workspace,payload){
      const u=auth.currentUser;
      if(!isGoogleUser(u)) throw new Error('Phiên Google đã hết. Vui lòng đăng nhập lại.');
      await setDoc(userDoc(u),{
        ...payload,
        ownerUid:u.uid,
        accountType:'google',
        authProvider:'google.com',
        displayName:u.displayName||'',
        email:u.email||'',
        photoURL:u.photoURL||'',
        emailVerified:!!u.emailVerified,
        serverUpdatedAt:serverTimestamp()
      },{merge:false});
      // V56 DELETE MONTH FIX:
      // Workspace payload là snapshot đầy đủ. Dùng replace thay vì merge để các tháng
      // đã bị xoá local cũng bị xoá thật trên Firestore, tránh realtime kéo lại tháng cũ.
      return true;
    },
    async load(){
      const u=auth.currentUser;
      if(!isGoogleUser(u)) throw new Error('Bạn chưa đăng nhập Google.');
      const snap=await getDoc(userDoc(u));
      return snap.exists()?snap.data():null;
    },
    listen(_workspace,onData,onError){
      const u=auth.currentUser;
      if(!isGoogleUser(u)){ queueMicrotask(()=>onError?.(new Error('Bạn chưa đăng nhập Google.'))); return ()=>{}; }
      return onSnapshot(userDoc(u),snap=>onData(snap.exists()?snap.data():null),onError);
    }
  };
}

async function ensureProfile(user){
  await setDoc(userDoc(user),{
    ownerUid:user.uid,
    accountType:'google', authProvider:'google.com',
    displayName:user.displayName||'', email:user.email||'', photoURL:user.photoURL||'',
    emailVerified:!!user.emailVerified,
    profileUpdatedAt:serverTimestamp()
  },{merge:true});
}

function renderCloudButton(){
  const btn=qs('#cloudBtn'); if(!btn) return;
  if(!currentUser){btn.classList.remove('ok','g48AccountBtn');btn.textContent='Đăng nhập Google';return;}
  btn.classList.add('ok','g48AccountBtn');
  const name=profileName(currentUser);
  const avatar=currentUser.photoURL
    ? `<img class="g48MiniAvatar" src="${esc(currentUser.photoURL)}" alt="">`
    : `<span class="g48MiniFallback">${esc(name.slice(0,1).toUpperCase())}</span>`;
  btn.innerHTML=`${avatar}<span class="g48AccountText">${esc(name)}</span>`;
  const foot=qs('#cloudFoot'); if(foot) foot.textContent='● Google Cloud · tự lưu & đồng bộ realtime';
}

function createAccountPanel(){
  if(accountPanel) return accountPanel;
  const el=document.createElement('div'); el.id='g48AccountPanel'; el.className='g48AccountPanel';
  el.addEventListener('click',e=>{if(e.target===el)el.classList.remove('show');});
  document.body.appendChild(el); accountPanel=el; return el;
}
function openAccountPanel(){
  if(!currentUser){showLogin();return;}
  const el=createAccountPanel(); const name=profileName(currentUser);
  const avatar=currentUser.photoURL
    ? `<img class="g48Avatar" src="${esc(currentUser.photoURL)}" alt="">`
    : `<div class="g48Avatar g48AvatarFallback">${esc(name.slice(0,1).toUpperCase())}</div>`;
  el.innerHTML=`<div class="g48AccountCard">
    <div class="g48Profile">${avatar}<div><div class="g48Name">${esc(name)}</div><div class="g48Email">${esc(currentUser.email||'')}</div></div></div>
    <div class="g48SyncState"><span class="g48LiveDot"></span><span>Dữ liệu đang đồng bộ realtime theo tài khoản này</span></div>
    <div class="g48PanelActions"><button type="button" id="g48SyncNow">Đồng bộ ngay</button><button type="button" class="danger" id="g48Logout">Đăng xuất</button></div>
  </div>`;
  el.classList.add('show');
  qs('#g48SyncNow').onclick=async()=>{try{if(typeof window.pushCloud==='function')await window.pushCloud(false);else toastSafe('Đồng bộ tự động đang hoạt động.');}finally{el.classList.remove('show');}};
  qs('#g48Logout').onclick=logoutGoogle;
}

async function logoutGoogle(){
  try{
    accountPanel?.classList.remove('show');
    await signOut(auth);
    [LOGIN_FLAG,LOGIN_KEY,'workspace_login_done','workspace_login_key',GOOGLE_UID,GOOGLE_EMAIL].forEach(k=>localStorage.removeItem(k));
    LEGACY_FLAGS.forEach(k=>localStorage.removeItem(k)); LEGACY_KEYS.forEach(k=>localStorage.removeItem(k));
    localStorage.removeItem(CLOUD_KEY);
  }finally{ location.reload(); }
}

function installUIOverrides(){
  window.openCloudPanel=openAccountPanel;
  window.closeCloudPanel=()=>accountPanel?.classList.remove('show');
  window.v44ChangeWorkspace=logoutGoogle;
  window.v39ChangeWorkspace=logoutGoogle;
  window.v38ResetLogin=logoutGoogle;
  window.updateCloudUI=renderCloudButton;
  qs('#v44LoginOverlay')?.remove();
  qs('#cloudPanel')?.classList.remove('show');
  const change=qs('#v44ChangeWorkspaceBtn'); if(change){change.textContent='Đăng xuất Google';change.onclick=logoutGoogle;}
  renderCloudButton();
}

async function activateUser(user){
  currentUser=user;
  writeAccountScope(user);
  installCloud(user);
  installUIOverrides();
  hideLogin();
  try{await ensureProfile(user);}catch(e){console.error('profile sync',e);toastSafe('Không thể cập nhật hồ sơ Cloud: '+(e.message||e));}
  // Phát sự kiện cũ để giữ nguyên toàn bộ luồng pull/listen/save hiện hữu của trang.
  window.dispatchEvent(new Event('firebase-cloud-ready'));
  setTimeout(()=>{try{if(typeof window.startCloudSync==='function')window.startCloudSync(true);}catch(e){}},80);
}

await setPersistence(auth,browserLocalPersistence).catch(()=>{});
onAuthStateChanged(auth,async user=>{
  if(user?.isAnonymous){
    if(!authBooted){authBooted=true;await signOut(auth).catch(()=>{});} showLogin(); return;
  }
  if(user && !isGoogleUser(user)){
    await signOut(auth).catch(()=>{}); showLogin('Vui lòng đăng nhập bằng tài khoản Google.'); return;
  }
  authBooted=true;
  if(!user){ currentUser=null; delete window.firebaseCloud; installUIOverrides(); showLogin(); return; }
  await activateUser(user);
});

// Chặn UI workspace cũ nếu script/HTML cũ còn sót lại do cache.
const observer=new MutationObserver(()=>{qs('#v44LoginOverlay')?.remove();qs('#cloudPanel')?.classList.remove('show');});
observer.observe(document.documentElement,{childList:true,subtree:true});
