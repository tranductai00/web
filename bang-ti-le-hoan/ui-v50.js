/* V50 UI ONLY — đổi nhãn hiển thị, không sửa công thức hay dữ liệu */
(() => {
  'use strict';

  const LABELS = new Map([
    ['Tổng SL đơn', ['Tổng đơn', 'Tổng số lượng đơn']],
    ['SL đơn đã gửi', ['SL đã gửi', 'Số lượng đơn đã gửi']],
    ['SL đơn đã giao TC', ['Giao TC', 'Số lượng đơn giao thành công']],
    ['SL đơn đã hoàn', ['Đã hoàn', 'Số lượng đơn đã hoàn']],
    ['SL đơn còn lại đang giao', ['Còn lại', 'Số lượng đơn còn lại đang giao']],
    ['Tỷ lệ giao TC', ['TL giao TC', 'Tỷ lệ giao thành công']],
    ['Tỷ lệ hoàn/chưa giao', ['TL hoàn/chưa giao', 'Tỷ lệ hoàn / chưa giao']]
  ]);

  function normalize(s){ return String(s || '').replace(/\s+/g,' ').trim(); }

  function applyShortHeaders(){
    const table = document.getElementById('table');
    if(!table) return;
    const headers = table.querySelectorAll('thead tr:nth-child(2) th');
    headers.forEach(th => {
      const current = normalize(th.textContent);
      for(const [longLabel, values] of LABELS){
        const shortLabel = values[0];
        const tooltip = values[1];
        if(current === longLabel || current === shortLabel){
          if(th.textContent !== shortLabel) th.textContent = shortLabel;
          th.title = tooltip;
          th.setAttribute('data-v50-short','1');
          break;
        }
      }
    });
  }

  function applyUploadHints(){
    const drop = document.getElementById('drop');
    if(drop) drop.title = 'Chọn hoặc kéo file Excel vào đây';
    document.querySelectorAll('.monthItem').forEach(item => {
      if(!item.title) item.title = 'Bấm để chọn / bỏ chọn tháng';
    });
  }

  function applyUI(){
    applyShortHeaders();
    applyUploadHints();
  }

  let raf = 0;
  const schedule = () => {
    if(raf) return;
    raf = requestAnimationFrame(() => { raf = 0; applyUI(); });
  };

  const start = () => {
    applyUI();
    const table = document.getElementById('table');
    const monthList = document.getElementById('monthList');
    const cfg = {subtree:true, childList:true, characterData:true};
    if(table) new MutationObserver(schedule).observe(table, cfg);
    if(monthList) new MutationObserver(schedule).observe(monthList, cfg);
    window.addEventListener('resize', schedule, {passive:true});
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
