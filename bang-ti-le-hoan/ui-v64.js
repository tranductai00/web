/* V64 — FILE DELETE FIX ONLY
   Giữ nguyên toàn bộ chức năng/UI V63.
   Chỉ đảm bảo xóa file Excel đang chọn hoạt động ổn định.
*/
(() => {
  'use strict';

  const q = (s, r=document) => r.querySelector(s);
  const qa = (s, r=document) => [...r.querySelectorAll(s)];

  function resetNativeInput(){
    const input = q('#fileInput');
    if(input){
      try{ input.value = ''; }catch(e){}
    }
  }

  function refreshCountFallback(){
    const list = q('#fileList');
    const count = q('#fileCount');
    if(!list || !count) return;
    const n = qa('.filePill', list).length;
    count.textContent = n + ' file';
    if(n === 0 && !list.querySelector('[data-v64-empty]')){
      list.innerHTML = '<div data-v64-empty="1" style="color:var(--muted);padding:12px">Chưa có file nào</div>';
    }
  }

  function removeByIndex(index, pill){
    if(typeof window.removeFile === 'function'){
      try{
        window.removeFile(index);
        resetNativeInput();
        return true;
      }catch(err){
        console.warn('[V64] removeFile fallback:', err);
      }
    }
    // UI fallback cuối cùng — chỉ dùng nếu hàm gốc không tồn tại.
    if(pill && pill.isConnected) pill.remove();
    resetNativeInput();
    refreshCountFallback();
    return false;
  }

  function clearAll(){
    if(typeof window.clearFiles === 'function'){
      try{
        window.clearFiles();
        resetNativeInput();
        return true;
      }catch(err){
        console.warn('[V64] clearFiles fallback:', err);
      }
    }
    const list = q('#fileList');
    if(list) list.innerHTML = '<div data-v64-empty="1" style="color:var(--muted);padding:12px">Chưa có file nào</div>';
    resetNativeInput();
    refreshCountFallback();
    return false;
  }

  // Capture phase để không phụ thuộc inline onclick bị lỗi sau các lớp UI patch.
  document.addEventListener('click', (event) => {
    const removeBtn = event.target.closest?.('.filePill button');
    if(removeBtn){
      const pill = removeBtn.closest('.filePill');
      const list = pill?.parentElement;
      if(!pill || !list) return;
      const index = qa('.filePill', list).indexOf(pill);
      if(index < 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      removeByIndex(index, pill);
      return;
    }

    const button = event.target.closest?.('button,.btn');
    if(button && /x[oó]a\s+file\s+ch[oọ]n/i.test((button.textContent || '').trim())){
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      clearAll();
    }
  }, true);

  // Đảm bảo chọn lại chính file vừa xóa vẫn phát sinh change.
  document.addEventListener('click', (event) => {
    const add = event.target.closest?.('button,.btn');
    if(add && /th[eê]m\s+file/i.test((add.textContent || '').trim())){
      resetNativeInput();
    }
  }, true);
})();
