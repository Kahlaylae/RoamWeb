// download.js - populates download section from manifest and handles PWA install
(function(){
  function qs(sel,root=document){ return root.querySelector(sel); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();

  function init(){
    const metaHost = qs('#pwaMeta');
    if(!metaHost) return;
    fetchManifest().then(man=>{
      const parts = [];
      // (Name intentionally hidden from display per request)
      if(man.description) parts.push(`<p style="margin:0;font-size:.85rem;line-height:1.45;font-weight:500;">${escapeHTML(man.description)}</p>`);
      if(man.theme_color || man.background_color){
        parts.push(`<p style="margin:0;font-size:.7rem;"><strong>Theme:</strong> <span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${man.theme_color};border:1px solid rgba(255,255,255,0.3);vertical-align:middle;margin-right:4px;"></span>${escapeHTML(man.theme_color)}</p>`);
      }
      if(Array.isArray(man.icons)){
        const first = man.icons[0];
        if(first){
          parts.push(`<div style="display:flex;align-items:center;gap:.6rem;margin-top:.2rem;">`+
            `<img src="${escapeAttr(first.src)}" alt="icon" style="width:48px;height:48px;border-radius:12px;border:1px solid rgba(255,255,255,0.15);background:#222;object-fit:cover;"/>`+
            `<span style="font-size:.65rem;letter-spacing:.5px;text-transform:uppercase;opacity:.85;">Install Ready</span>`+
          `</div>`);
        }
      }
      metaHost.innerHTML = parts.join('');
  injectStyles();
  renderHandles(man.handles||{});
  }).catch(()=>{ metaHost.innerHTML = '<p class="caption" style="margin:0;">Manifest unavailable</p>'; });

    // install prompt
    let deferredEvt = null;
    window.addEventListener('beforeinstallprompt', e=>{
      e.preventDefault();
      deferredEvt = e;
      const btn = qs('#installBtn');
      if(!btn) return;
      btn.style.display='inline-block';
      btn.addEventListener('click', ()=>{
        btn.disabled = true; btn.textContent='Installing...';
        deferredEvt.prompt();
        deferredEvt.userChoice.finally(()=>{ setTimeout(()=>{btn.style.display='none';}, 800); });
      }, { once:true });
    });
  }

  function fetchManifest(){
    const paths = ['/jsonassets/manifest.json','jsonassets/manifest.json','./jsonassets/manifest.json'];
    let lastErr;
    return paths.reduce((chain,p)=>{
      return chain.catch(()=>fetch(p).then(r=>{ if(!r.ok) throw new Error(r.status); return r.json(); }));
    }, Promise.reject()).catch(err=>{ throw lastErr||err; });
  }

  function renderHandles(handles){
    const hList = qs('#handlesList');
    if(!hList) return;
    const order = [
      ['Instagram','instagram','📸'],
      ['TikTok','tiktok','🎵'],
      ['Twitter','twitter','🐦'],
      ['YouTube','youtube','▶️'],
      ['Facebook','facebook','🟦'],
      ['Website','website','🌐']
    ];
    hList.innerHTML = order.filter(([label,key])=> handles[key]).map(([label,key,icon])=>{
      const url = handles[key];
      return `<li><a class="social-follow-link ${key}" href="${escapeAttr(url)}" target="_blank" rel="noopener"><span class="icon">${icon}</span>${escapeHTML(label)}</a></li>`;
    }).join('');
  }

  // (extractUser removed; usernames no longer displayed)

  function injectStyles(){}

  function escapeHTML(str){ return String(str||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
  function escapeAttr(str){ return escapeHTML(str); }
})();
