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
      listEl.innerHTML = '<p style="color:#4a5568;font-size:.9rem;margin:.5rem 0;">No posts yet — check back soon.</p>';
      return;
    }
    posts.forEach((p,i)=> listEl.appendChild(buildCard(p, i===0)) );
  }

  function buildCard(p, isFeatured){
    const card = ce('a');
    card.className = 'story-card' + (isFeatured ? ' featured' : '');
    card.href = escapeHTML(p.url || '#');
    card.innerHTML = `
      <div class="story-image">
        <img src="${escapeHTML(p.image||'/assets/placeholder.webp')}" alt="${escapeHTML(p.title)}" loading="lazy" />
      </div>
      <div class="${isFeatured ? 'story-card-body' : ''}">
      ${isFeatured ? '<span class="story-featured">★ Latest</span>' : ''}
      ${p.tag ? `<span class="story-tag">${escapeHTML(p.tag)}</span>` : ''}
      <div class="story-date">${formatDate(p._date)}</div>
      <div class="story-title">${escapeHTML(p.title)}</div>
      <div class="story-excerpt">${escapeHTML(trimDesc(p.description, 130))}</div>
      <span class="story-read-link">Read &rarr;</span>
      </div>
    `;
    return card;
  }

  function formatDate(d){
    if(!d || !d.getTime()) return '';
    return d.toLocaleDateString(undefined,{ year:'numeric', month:'short', day:'numeric'});
  }
  function trimDesc(str, len){ if(!str) return ''; if(str.length<=len) return str; return str.slice(0,len-3)+'...'; }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
