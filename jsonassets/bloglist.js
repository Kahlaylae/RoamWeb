// bloglist.js - dynamic blog section rendering from content.json
(function(){
  const CONTENT_URL = '/jsonassets/content.json';
  let posts = [];
  let featured = null; // still track for badge only

  function qs(sel,root=document){ return root.querySelector(sel); }
  function ce(tag,cls){ const el=document.createElement(tag); if(cls) el.className=cls; return el; }
  function escapeHTML(str){ return String(str||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

  function parseDate(str){
    // expecting formats like "August 25,2025" or "August 25, 2025"
    if(!str) return new Date(0);
    const cleaned = str.replace(/,(?=\d{4}$)/, ', '); // ensure space before year for Date parsing
    const d = new Date(cleaned);
    return isNaN(d.getTime()) ? new Date(0) : d;
  }

  function init(){
    const listEl = qs('#blogList');
    if(!listEl) return;
    listEl.insertAdjacentHTML('afterbegin', '<p class="caption" id="blogLoading" style="margin:0 0 .75rem 0;">Loading posts...</p>');
    fetch(CONTENT_URL,{cache:'no-store'}).then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(json=>{
        posts = (json||[]).map(p=> ({...p, _date: parseDate(p.date)})).sort((a,b)=> b._date - a._date);
  featured = posts[0] || null; // first (latest) post
        render(listEl);
      })
      .catch(err=>{ console.error('blog load fail', err); const l=qs('#blogLoading'); if(l) l.textContent='Unable to load posts.'; });
  }

  function render(listEl){
    const loading = qs('#blogLoading'); if(loading) loading.remove();
    listEl.innerHTML='';
    if(!posts.length){
      listEl.innerHTML = '<p class="caption" style="margin:.5rem 0;">No posts yet</p>';
      return;
    }
    const grid = ce('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:1rem;margin-top:.25rem;';
    posts.forEach((p,i)=> grid.appendChild(buildCard(p, i===0)) );
    listEl.appendChild(grid);
  }

  function buildCard(p, isFeatured){
    const card = ce('div');
    card.className = 'sectionListItem';
    card.style.padding = '.75rem .85rem 1rem';
    card.style.margin = '0';
    card.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:.55rem;">
        <div style="position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:12px;border:1px solid rgba(255,255,255,0.12);background:#222;">
          <img src="${escapeHTML(p.image||'/assets/placeholder.webp')}" alt="${escapeHTML(p.title)}" style="width:100%;height:100%;object-fit:cover;" loading="lazy" />
          ${isFeatured?`<span style=\"position:absolute;left:.55rem;top:.55rem;background:#fbbf24;color:#fff;font-size:.55rem;font-weight:600;padding:.32rem .6rem;border-radius:999px;letter-spacing:.55px;text-transform:uppercase;display:inline-flex;align-items:center;gap:.35rem;box-shadow:0 2px 4px rgba(0,0,0,0.35);\">★ Featured</span>`:''}
        </div>
        <h3 style="margin:0;font-size:.85rem;line-height:1.25;">${escapeHTML(p.title)}</h3>
        <p style="margin:0;font-size:.55rem;letter-spacing:.45px;text-transform:uppercase;color:#bbb;display:flex;gap:.5rem;flex-wrap:wrap;">
          <span>${formatDate(p._date)}</span>
          ${p.tag?`<span style=\"background:#222;padding:.2rem .5rem;border-radius:999px;\">${escapeHTML(p.tag)}</span>`:''}
        </p>
        <p style="margin:.25rem 0 0;font-size:.65rem;color:#ccc;line-height:1.35;">${escapeHTML(trimDesc(p.description, 110))}</p>
        <div style="margin-top:auto;">
          <a href="${escapeHTML(p.url||'#')}" style="color:#9fd4ff;font-size:.65rem;">Read →</a>
        </div>
      </div>`;
    card.addEventListener('click', e=>{ if(e.target.tagName!=='A') window.location.href=p.url; });
    return card;
  }

  function formatDate(d){
    if(!d || !d.getTime()) return '';
    return d.toLocaleDateString(undefined,{ year:'numeric', month:'short', day:'numeric'});
  }
  function trimDesc(str, len){ if(!str) return ''; if(str.length<=len) return str; return str.slice(0,len-3)+'...'; }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
