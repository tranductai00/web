(function(){
  function stripLead(text){
    if(!text) return text;
    return text
      .replace(/^\s*[①②❶❷㈠㈡]|^\s*0?[12]\s+/u,'')
      .replace(/^\s*[0０][12]\s+/u,'')
      .trim();
  }
  function run(){
    const candidates=[...document.querySelectorAll('h1,h2,h3,h4,.title,button,div,span')];
    for(const el of candidates){
      if(el.children.length===0){
        const t=(el.textContent||'').trim();
        if(/^([①②❶❷㈠㈡]|0?[12])\s*(Tải file Excel|Chọn tháng)/u.test(t)){
          el.textContent = stripLead(t);
        }
      }
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',run);
  else run();
  new MutationObserver(()=>run()).observe(document.documentElement,{childList:true,subtree:true});
})();
