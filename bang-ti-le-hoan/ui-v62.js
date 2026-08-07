(() => {
  'use strict';

  function stripLead(text){
    return String(text || '')
      .replace(/^\s*[①②❶❷㈠㈡]/u,'')
      .replace(/^\s*0?[12]\s+/u,'')
      .replace(/^\s*0[12](?=\D)/u,'')
      .trim();
  }

  function q(sel, root=document){ return root.querySelector(sel); }
  function qa(sel, root=document){ return [...root.querySelectorAll(sel)]; }

  function cleanTitles(){
    qa('.title').forEach(el => {
      const t = (el.textContent || '').trim();
      if(/^(?:[①②❶❷㈠㈡]|0?[12])\s*(Tải file Excel|Chọn tháng|File đã chọn)$/u.test(t)){
        el.textContent = stripLead(t);
      }
    });
  }

  function enhanceUpload(){
    const upload = q('.compactTop .upload');
    if(!upload) return;
    const title = q('.title', upload);
    const fileRow = q('.fileTitleRow', upload);
    const drop = q('.miniDrop', upload) || q('#drop', upload);
    const fileList = q('.compactFileList', upload);
    const actions = q('.uploadActions', upload);
    if(!title || !fileRow || !drop || !fileList || !actions) return;

    let shell = q('.v62-upload-shell', upload);
    if(!shell){
      shell = document.createElement('div');
      shell.className = 'v62-upload-shell';

      const header = document.createElement('div');
      header.className = 'v62-upload-header';
      const titleWrap = document.createElement('div');
      titleWrap.className = 'v62-title-wrap';
      titleWrap.appendChild(title);
      header.appendChild(titleWrap);
      header.appendChild(fileRow);

      const content = document.createElement('div');
      content.className = 'v62-upload-content';
      const right = document.createElement('div');
      right.className = 'v62-upload-right';
      right.appendChild(fileList);
      right.appendChild(actions);
      content.appendChild(drop);
      content.appendChild(right);

      const support = document.createElement('div');
      support.className = 'v62-upload-support';
      support.textContent = 'Hỗ trợ: Excel (.xlsx, .xls)';

      shell.append(header, content, support);
      upload.appendChild(shell);
    }
  }

  function ensureMonthSummary(){
    const side = q('.compactTop .compactSide');
    const sideActions = q('.sideActions', side || document);
    if(!side || !sideActions) return;
    let summary = q('.v62-side-summary', sideActions);
    if(!summary){
      summary = document.createElement('div');
      summary.className = 'v62-side-summary';
      summary.innerHTML = 'Đã chọn: <span class="count">0 tháng</span>';
      sideActions.prepend(summary);
    }
    const count = qa('.monthItem input[type="checkbox"]:checked, .monthItem.active input[type="checkbox"], .monthItem.active', side)
      .reduce((n, el) => n + (el.matches('.monthItem.active') ? 0 : 1), 0);
    const activeCount = Math.max(count, qa('.monthItem.active', side).length);
    const num = activeCount || qa('.monthItem input[type="checkbox"]:checked', side).length;
    q('.count', summary).textContent = `${num} tháng`;
  }

  function tuneMonthExtras(){
    const side = q('.compactTop .compactSide');
    if(!side) return;
    const monthBox = q('.compactMonthBox', side);
    if(monthBox && !q('.v62-add-proxy', monthBox)){
      const btn = q('.sideActions .btn', side);
      if(btn){
        const proxy = document.createElement('button');
        proxy.type = 'button';
        proxy.className = 'v62-add-proxy';
        proxy.setAttribute('style','border:0;background:transparent;padding:0;cursor:pointer');
        proxy.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px">Chọn thêm</div>';
        proxy.addEventListener('click', () => btn.click());
        monthBox.appendChild(proxy);
      }
    }
  }

  function apply(){
    cleanTitles();
    enhanceUpload();
    tuneMonthExtras();
    ensureMonthSummary();
  }

  let raf = 0;
  const schedule = () => {
    if(raf) return;
    raf = requestAnimationFrame(() => { raf = 0; apply(); });
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, {once:true});
  else schedule();

  new MutationObserver(schedule).observe(document.documentElement, {subtree:true, childList:true, characterData:true, attributes:true});
})();
