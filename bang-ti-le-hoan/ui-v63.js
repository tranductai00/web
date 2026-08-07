(() => {
  'use strict';

  const norm = (s) => String(s || '').replace(/\s+/g,' ').trim();
  const stripLead = (text) => norm(text)
    .replace(/^\s*[①②❶❷㈠㈡]/u,'')
    .replace(/^\s*0?[12]\s+/u,'')
    .replace(/^\s*0[12](?=\D)/u,'')
    .trim();
  const q = (sel, root=document) => root.querySelector(sel);
  const qa = (sel, root=document) => [...root.querySelectorAll(sel)];

  function byText(root, selector, text){
    return qa(selector, root).find(el => norm(el.textContent).includes(text));
  }

  function cleanTitleText(){
    qa('.title, h1, h2, h3').forEach(el => {
      const t = norm(el.textContent);
      if(/^(?:[①②❶❷㈠㈡]|0?[12])\s*(Tải file Excel|Chọn tháng|File đã chọn)$/u.test(t)){
        el.textContent = stripLead(t);
      }
    });
  }

  function enhanceUpload(){
    const upload = q('.compactTop .upload');
    if(!upload) return;

    const mainTitle = byText(upload, '.title,h1,h2,h3,div,span', 'Tải file Excel');
    const fileTitle = byText(upload, '.title,h1,h2,h3,div,span', 'File đã chọn');
    const fileCount = q('#fileCount', upload);
    const addBtn = qa('button,.btn', upload).find(el => norm(el.textContent).includes('Thêm file'));
    const drop = q('.miniDrop', upload) || q('#drop', upload);
    const fileList = q('.compactFileList', upload);
    const actions = q('.uploadActions', upload);
    if(!mainTitle || !drop || !fileList || !actions) return;

    const existing = q('.v63-upload-shell', upload);
    if(existing) return;

    const shell = document.createElement('div');
    shell.className = 'v63-upload-shell';

    const header = document.createElement('div');
    header.className = 'v63-upload-header';
    header.appendChild(mainTitle);

    const row = document.createElement('div');
    row.className = 'fileTitleRow';
    if(fileTitle) row.appendChild(fileTitle);
    if(fileCount) row.appendChild(fileCount);
    if(addBtn) row.appendChild(addBtn);
    header.appendChild(row);

    const content = document.createElement('div');
    content.className = 'v63-upload-content';
    content.appendChild(drop);

    const right = document.createElement('div');
    right.className = 'v63-upload-right';
    right.appendChild(fileList);
    right.appendChild(actions);
    content.appendChild(right);

    const support = document.createElement('div');
    support.className = 'v63-upload-support';
    support.textContent = 'Hỗ trợ: Excel (.xlsx, .xls)';

    shell.append(header, content, support);
    upload.appendChild(shell);
  }

  function updateSummary(){
    const side = q('.compactTop .compactSide');
    const sideActions = q('.sideActions', side || document);
    if(!side || !sideActions) return;
    let summary = q('.v63-side-summary', sideActions);
    if(!summary){
      summary = document.createElement('div');
      summary.className = 'v63-side-summary';
      summary.innerHTML = 'Đã chọn: <span class="count">0 tháng</span>';
      sideActions.prepend(summary);
    }
    const count = qa('.monthItem.active', side).length || qa('.monthItem input[type="checkbox"]:checked', side).length;
    const countEl = q('.count', summary);
    if(countEl) countEl.textContent = `${count} tháng`;
  }

  function ensureAddProxy(){
    const side = q('.compactTop .compactSide');
    const monthBox = q('.compactMonthBox', side || document);
    const btn = q('.sideActions .btn', side || document);
    if(!monthBox || !btn || q('.v63-add-proxy', monthBox)) return;
    const proxy = document.createElement('button');
    proxy.type = 'button';
    proxy.className = 'v63-add-proxy';
    proxy.textContent = 'Chọn thêm';
    proxy.addEventListener('click', () => btn.click());
    monthBox.appendChild(proxy);
  }

  function guessKeyMatches(obj, label){
    const v = norm(label).toLowerCase();
    if(!obj || typeof obj !== 'object') return false;
    for(const k of ['name','title','label','month','thang','key','id']){
      if(typeof obj[k] === 'string'){
        const s = norm(obj[k]).toLowerCase();
        if(s === v || s.includes(v) || v.includes(s)) return true;
      }
    }
    return false;
  }

  function deepRemove(value, label){
    let changed = false;
    if(Array.isArray(value)){
      const out = [];
      for(const item of value){
        if(guessKeyMatches(item, label) || (typeof item === 'string' && norm(item).toLowerCase() === norm(label).toLowerCase())){
          changed = true;
          continue;
        }
        const [next, ch] = deepRemove(item, label);
        if(ch) changed = true;
        out.push(next);
      }
      return [out, changed];
    }
    if(value && typeof value === 'object'){
      const out = Array.isArray(value) ? [] : {};
      for(const [k,v] of Object.entries(value)){
        const [next, ch] = deepRemove(v, label);
        if(ch) changed = true;
        out[k] = next;
      }
      return [out, changed];
    }
    return [value, false];
  }

  function fallbackDelete(item){
    const nameEl = q('.monthName', item);
    const label = norm(nameEl ? nameEl.textContent : item.textContent);
    try{
      for(let i=0;i<localStorage.length;i++){
        const key = localStorage.key(i);
        if(!key) continue;
        const raw = localStorage.getItem(key);
        if(!raw || raw.length < 2) continue;
        try{
          const parsed = JSON.parse(raw);
          const [next, changed] = deepRemove(parsed, label);
          if(changed) localStorage.setItem(key, JSON.stringify(next));
        }catch{}
      }
    }catch{}
    item.remove();
    updateSummary();
    try{ window.dispatchEvent(new Event('storage')); }catch{}
  }

  function hookDeleteFallback(){
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.deleteMonth');
      if(!btn) return;
      const item = btn.closest('.monthItem');
      if(!item) return;
      const beforeParent = item.parentElement;
      setTimeout(() => {
        if(beforeParent && beforeParent.contains(item)){
          fallbackDelete(item);
        }
      }, 250);
    }, true);
  }

  function apply(){
    cleanTitleText();
    enhanceUpload();
    ensureAddProxy();
    updateSummary();
  }

  let hooked = false;
  let raf = 0;
  const schedule = () => {
    if(raf) return;
    raf = requestAnimationFrame(() => { raf = 0; apply(); });
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, {once:true});
  else schedule();

  if(!hooked){ hookDeleteFallback(); hooked = true; }
  new MutationObserver(schedule).observe(document.documentElement, {subtree:true, childList:true, characterData:true, attributes:true});
})();
