(function(){
  'use strict';

  // User page: ONLY sync data. All Pancake API settings live in /bang-ti-le-hoan-admin/.
  // This module never calculates return/success rates; it feeds the legacy 5-column parser unchanged.
  const VERSION='2.2.0-github-saved-filter-product-fallback';
  let api=null, modal=null, busy=false, config=null;

  function qs(s,root=document){return root.querySelector(s);}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function toastMsg(msg){try{if(typeof window.toast==='function')window.toast(msg);else console.log(msg);}catch(_){console.log(msg);}}
  function bridge(){return window.googleAccountBridge||null;}
  function user(){try{return bridge()?.getUser?.()||null;}catch(_){return null;}}
  function pad(n){return String(n).padStart(2,'0');}
  function dateInput(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
  function defaults(){const now=new Date();const start=new Date(now.getFullYear(),now.getMonth(),1);return{start:dateInput(start),end:dateInput(now),month:`Tháng ${now.getMonth()+1}/${now.getFullYear()}`};}
  function clonePlain(v){try{return structuredClone(v);}catch(_){try{return JSON.parse(JSON.stringify(v));}catch(__){return v;}}}

  async function loadApi(){
    if(api)return api;
    api=await import('./pancake-browser-common.js?v=4');
    return api;
  }

  async function loadConfig(){
    const b=bridge();
    if(!b?.loadPancakeAdminConfig)return null;
    config=await b.loadPancakeAdminConfig();
    return config;
  }

  function ensureTopButton(){
    let btn=qs('#pksOpenBtn'); if(btn)return btn;
    const topRight=qs('.topRight')||qs('header .actions')||qs('header');
    if(!topRight)return null;
    btn=document.createElement('button');
    btn.type='button';btn.id='pksOpenBtn';btn.className='pksOpenBtn';
    btn.innerHTML='<span class="pksIcon">P</span><span>Đồng bộ Pancake</span>';
    btn.addEventListener('click',openModal);
    const cloud=qs('#cloudBtn',topRight);
    if(cloud?.nextSibling)topRight.insertBefore(btn,cloud.nextSibling);else topRight.appendChild(btn);
    return btn;
  }

  function createModal(){
    if(modal)return modal;
    modal=document.createElement('div');modal.id='pksModal';modal.className='pksModal';
    modal.innerHTML=`
      <div class="pksCard pksUserCard" role="dialog" aria-modal="true" aria-labelledby="pksTitle">
        <div class="pksHead">
          <div><div class="pksEyebrow">NGUỒN DỮ LIỆU TỰ ĐỘNG</div><h2 id="pksTitle">Đồng bộ Pancake POS</h2><p>Cấu hình API do quản trị viên thiết lập riêng cho tài khoản này.</p></div>
          <button type="button" class="pksClose" id="pksClose" aria-label="Đóng">×</button>
        </div>
        <div class="pksAccount" id="pksAccount"></div>
        <div class="pksConfigNotice" id="pksConfigNotice"></div>
        <div class="pksDivider"></div>
        <div class="pksGrid pksDates">
          <label><span>Từ ngày</span><input id="pksStart" type="date"></label>
          <label><span>Đến ngày</span><input id="pksEnd" type="date"></label>
          <label class="pksWide"><span>Tên tháng trên bảng so sánh</span><input id="pksMonthName" placeholder="Tháng 8/2026"></label>
        </div>
        <label class="pksCheck"><input id="pksReplace" type="checkbox" checked><span>Cập nhật/ghi đè tháng cùng tên bằng dữ liệu API mới</span></label>
        <div id="pksStatus" class="pksStatus" aria-live="polite"></div>
        <div class="pksActions">
          <button type="button" class="pksBtn" id="pksTest">Kiểm tra kết nối</button>
          <button type="button" class="pksBtn primary" id="pksSync">Lấy dữ liệu & cập nhật tháng</button>
        </div>
        <div class="pksFoot">Upload Excel thủ công vẫn hoạt động như trước. Pancake chỉ thay nguồn dữ liệu đầu vào; công thức tính không thay đổi.</div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click',e=>{if(e.target===modal)closeModal();});
    qs('#pksClose',modal).onclick=closeModal;
    qs('#pksTest',modal).onclick=testConnection;
    qs('#pksSync',modal).onclick=syncOrders;
    qs('#pksStart',modal).addEventListener('change',async()=>{
      const a=await loadApi();const input=qs('#pksMonthName',modal);
      if(input&&(!input.value.trim()||/^Tháng \d+\/\d{4}$/.test(input.value.trim())))input.value=a.monthFromDate(qs('#pksStart',modal).value);
    });
    return modal;
  }

  function setStatus(message,type=''){const el=qs('#pksStatus',modal);if(!el)return;el.className='pksStatus '+type;el.textContent=message||'';}
  function setBusy(on){busy=!!on;['#pksTest','#pksSync'].forEach(s=>{const x=qs(s,modal);if(x)x.disabled=busy||!config;});const x=qs('#pksSync',modal);if(x)x.textContent=busy?'Đang xử lý…':'Lấy dữ liệu & cập nhật tháng';}
  function values(){return{start:qs('#pksStart',modal)?.value||'',end:qs('#pksEnd',modal)?.value||'',monthName:qs('#pksMonthName',modal)?.value.trim()||'',replace:!!qs('#pksReplace',modal)?.checked};}
  function validateDates(v,a){if(!v.start||!v.end)throw new Error('Vui lòng chọn đầy đủ từ ngày và đến ngày.');if(a.unixDay(v.end,true)<a.unixDay(v.start,false))throw new Error('Ngày kết thúc phải sau ngày bắt đầu.');if(!v.monthName)throw new Error('Vui lòng nhập tên tháng.');}

  async function openModal(){
    if(!user()){toastMsg('Vui lòng đăng nhập Google trước.');return;}
    createModal();const d=defaults();const a=await loadApi();
    qs('#pksStart',modal).value=d.start;qs('#pksEnd',modal).value=d.end;qs('#pksMonthName',modal).value=d.month;
    qs('#pksAccount',modal).innerHTML=`<span class="pksDot"></span><div><b>${esc(user()?.displayName||user()?.email||'Tài khoản Google')}</b><small>${esc(user()?.email||'')}</small></div><span class="pksAccountScope">API do Admin quản lý</span>`;
    setStatus('Đang đọc cấu hình Pancake của tài khoản…','loading');modal.classList.add('show');
    try{
      await loadConfig();
      const notice=qs('#pksConfigNotice',modal);
      if(config?.shopId&&config?.savedFilterId&&config?.accessToken){
        notice.className='pksConfigNotice ok';
        notice.innerHTML=`<b>${esc(config.label||'Pancake POS')}</b><span>Đã được Admin cấu hình. Bạn chỉ cần chọn khoảng ngày và đồng bộ.</span>`;
        setStatus('Sẵn sàng đồng bộ.','ok');
      }else{
        notice.className='pksConfigNotice warn';
        notice.innerHTML='<b>Chưa được cấu hình Pancake API</b><span>Vui lòng liên hệ Admin để gán Shop, Saved Filter và token cho tài khoản này.</span>';
        setStatus('Không thể đồng bộ cho đến khi Admin cấu hình API.','warn');
      }
    }catch(e){config=null;setStatus('Không đọc được cấu hình Pancake: '+(e.message||e),'error');}
    setBusy(false);
  }

  function closeModal(){if(!busy)modal?.classList.remove('show');}

  async function fetchData(testOnly=false){
    const a=await loadApi();const v=values();validateDates(v,a);
    if(!config)await loadConfig();
    a.validatePancakeConfig(config);
    return a.fetchPancakeOrders({
      shopId:config.shopId,savedFilterId:config.savedFilterId,accessToken:config.accessToken,
      startDateTime:a.unixDay(v.start,false),endDateTime:a.unixDay(v.end,true),testOnly,
      onProgress:p=>{
        if(testOnly)return;
        if(p.phase==='details'){
          setStatus(`Đang lấy chi tiết sản phẩm: ${p.detailsDone||0}/${p.detailsTotal||0} đơn…`,'loading');
        }else{
          setStatus(`Đang tải Pancake: trang ${p.page}${p.totalPages>1?'/'+p.totalPages:''}…`,'loading');
        }
      }
    });
  }

  function commitToLegacy(rowsData,v){
    if(typeof window.parseRawOrderSheet!=='function')throw new Error('Bộ xử lý dữ liệu hiện tại chưa sẵn sàng. Hãy tải lại trang.');
    if(!Array.isArray(rowsData)||!rowsData.length)throw new Error('API không trả dòng sản phẩm nào để tính.');

    // Adapter duy nhất: API -> đúng 5 cột -> parser cũ. KHÔNG tính tỷ lệ tại đây.
    const aoa=[['Sản phẩm','Mã đơn hàng','Mã sản phẩm','Tên sản phẩm','Trạng thái']];
    for(const row of rowsData)aoa.push([row.product||row.name||row.code,row.orderId,row.code,row.name||row.code,row.status]);

    const existing=(typeof months!=='undefined'&&months[v.monthName])?clonePlain(months[v.monthName]):null;
    const before=new Set(typeof months!=='undefined'?Object.keys(months):[]);
    if(v.replace&&typeof months!=='undefined'&&months[v.monthName])delete months[v.monthName];

    const diags=[];let added=0;
    try{
      added=window.parseRawOrderSheet(aoa,'Pancake API',v.replace?`pancake-${Date.now()}`:`pancake-${Date.now()}-${Math.random()}`,v.monthName,diags);
      if(!added)throw new Error(diags.join(' · ')||'Bộ xử lý cũ không nhận được dữ liệu API.');
    }catch(e){
      if(v.replace&&existing&&typeof months!=='undefined')months[v.monthName]=existing;
      throw e;
    }

    const after=typeof months!=='undefined'?Object.keys(months):[];
    let actual=v.monthName;
    if(!(typeof months!=='undefined'&&months[actual]))actual=after.find(x=>!before.has(x))||after[after.length-1]||v.monthName;
    if(typeof selectedMonths!=='undefined'){
      selectedMonths=selectedMonths.filter(x=>x!==actual);selectedMonths.push(actual);
      if(selectedMonths.length>2)selectedMonths=selectedMonths.slice(-2);
    }
    if(typeof save==='function')save();
    if(typeof renderAll==='function')renderAll();
    return {actual,diags};
  }

  async function testConnection(){
    if(busy||!config)return;setBusy(true);setStatus('Đang kiểm tra kết nối Pancake…','loading');
    try{
      const data=await fetchData(true);
      const unknown=(await loadApi()).remainingUnknownStatuses(data.meta,config?.statusMap||{});
      const sample=Object.entries(data.meta?.statusCounts||{}).slice(0,6).map(([k,n])=>`${k}: ${n}`).join(' · ');
      if(Object.keys(unknown).length){
        setStatus(`Kết nối được ${data.totalEntries} đơn. Tuy nhiên còn mã trạng thái chưa được Admin gán: ${Object.entries(unknown).map(([k,n])=>`${k} (${n})`).join(', ')}. Vui lòng báo Admin trước khi đồng bộ.`, 'warn');
      }else setStatus(`Kết nối thành công · ${data.totalEntries} đơn${sample?' · '+sample:''}.`,'ok');
    }catch(e){setStatus(e.message||String(e),'error');}
    finally{setBusy(false);}
  }

  async function syncOrders(){
    if(busy||!config)return;setBusy(true);setStatus('Đang lấy đơn Pancake theo bộ lọc Admin đã cài…','loading');
    try{
      const a=await loadApi();const v=values();const data=await fetchData(false);
      if(data.truncated)throw new Error('Số trang đơn vượt giới hạn an toàn. Hãy thu hẹp khoảng ngày.');
      const unknown=a.remainingUnknownStatuses(data.meta,config?.statusMap||{});
      if(Object.keys(unknown).length)throw new Error('Có mã trạng thái Pancake chưa được Admin gán tên: '+Object.keys(unknown).join(', ')+'. Dữ liệu chưa được đưa vào bảng để tránh làm sai kết quả.');
      const rows=a.applyStatusMap(data.rows,config?.statusMap||{});
      if(!rows.length){
        const orderCount=Number(data.fetchedOrders||data.totalEntries||0);
        const m=data.meta||{};
        if(orderCount===0){
          throw new Error(`Bộ lọc Pancake không có đơn trong khoảng ${v.start} → ${v.end}. Không có dữ liệu nào được ghi đè.`);
        }
        const detailInfo=m.detailRequested
          ? ` Đã thử tải chi tiết ${m.detailRequested} đơn: thành công ${m.detailLoaded||0}, lỗi ${m.detailFailures||0}.`
          : '';
        const sample=Array.isArray(m.detailFailureSamples)&&m.detailFailureSamples.length
          ? ` Chi tiết lỗi: ${m.detailFailureSamples.join(' · ')}`
          : '';
        throw new Error(`Pancake đã trả ${orderCount} đơn nhưng chưa đọc được dòng sản phẩm.${detailInfo}${sample}`);
      }
      const committed=commitToLegacy(rows,v);
      const warnings=[];
      if(data.meta?.ordersWithoutItems)warnings.push(`${data.meta.ordersWithoutItems} đơn vẫn thiếu dòng sản phẩm`);
      if(data.meta?.detailFailures)warnings.push(`${data.meta.detailFailures} đơn lỗi khi tải chi tiết`);
      if(data.meta?.fallbackCodeCount)warnings.push(`${data.meta.fallbackCodeCount} item dùng mã dự phòng`);
      setStatus(`Đã cập nhật “${committed.actual}”: ${data.fetchedOrders}/${data.totalEntries||data.fetchedOrders} đơn, ${data.meta?.rowCount||rows.length} dòng sản phẩm, ${data.fetchedPages} trang.${data.meta?.detailLoaded?` Đã bổ sung chi tiết ${data.meta.detailLoaded} đơn.`:''}${warnings.length?' Lưu ý: '+warnings.join(' · ')+'.':''}`,warnings.length?'warn':'ok');
      toastMsg(`Đã lấy dữ liệu Pancake cho ${committed.actual}`);
    }catch(e){setStatus(e.message||String(e),'error');}
    finally{setBusy(false);}
  }

  async function boot(){ensureTopButton();if(user())try{await loadConfig();}catch(_){}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.addEventListener('google-account-ready',async()=>{ensureTopButton();try{await loadConfig();}catch(_){}});
  const obs=new MutationObserver(()=>{if(!qs('#pksOpenBtn'))ensureTopButton();});
  obs.observe(document.documentElement,{childList:true,subtree:true});
  window.pancakeIntegration={version:VERSION,mode:'admin-config-only'};
})();
