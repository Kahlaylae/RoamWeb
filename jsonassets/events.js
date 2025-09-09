// events.js - loads events.json and renders weekly events with day + "Now" filters
(function(){
  const EVENTS_URL = '/jsonassets/events.json';
  const DAY_ORDER = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  let events = [];
  let filtered = [];
  let currentFilter = '';// ''=all, 'now', or day name
  let dayBar = null;
  let container = null;
  let nowTimer = null;
  const EVENT_FAV_KEY = 'favorites_events_v1';
  let eventFavoriteSet = new Set();

  window.Events = { init }; // debug hook

  function qs(sel,root=document){ return root.querySelector(sel); }
  function ce(tag,cls){ const el=document.createElement(tag); if(cls) el.className=cls; return el; }

  function init(){
    container = qs('#eventList');
    if(!container) return;
    container.textContent = 'Loading events...';
    fetch(EVENTS_URL, { cache:'no-store'}).then(r=>{
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    }).then(json=>{
      events = parseEvents(json||[]);
  loadEventFavorites();
      ensureDayFilterBar();
      applyFilter('');
      startNowTicker();
  updateEventFavoritesUI();
    }).catch(err=>{
      console.error('events load failed', err);
      container.textContent='Unable to load events.';
    });
  }

  function parseEvents(arr){
    return arr.map(ev=> enrich(ev)).sort((a,b)=> a.startDate - b.startDate);
  }
  function enrich(ev){
    const copy = { ...ev };
    copy.day = (ev.eventday||'').toLowerCase();
    const desc = (ev.eventdesc||'').trim();
    let y, m, d, sh, eh;
    if(desc){
      const parts = desc.split('/');
      if(parts.length>=5){
        y = parseInt(parts[0],10); m = parseInt(parts[1],10); d = parseInt(parts[2],10);
        sh = parseFloat(parts[3]); eh = parseFloat(parts[4]);
      }
    }
    if(!isFinite(sh)) sh = ev.eventstart;
    if(!isFinite(eh)) eh = ev.eventend;
    // fallback date: pick upcoming date this week for stated day
    const now = new Date();
    if(!isFinite(y)){ // align to this week
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayIdx = base.getDay();
      const targetIdx = DAY_ORDER.indexOf(copy.day);
      let diff = targetIdx - todayIdx;
      if(diff < -3) diff += 7; // push into (possibly) next week if far past
      base.setDate(base.getDate()+diff);
      y = base.getFullYear(); m = base.getMonth()+1; d = base.getDate();
    }
    if(!isFinite(m)) m = now.getMonth()+1;
    if(!isFinite(d)) d = now.getDate();
    copy.startHour = sh; copy.endHour = eh;
    const startDate = makeDate(y,m,d,sh);
    let endDate = makeDate(y,m,d,eh);
    if(eh < sh){ // crosses midnight
      endDate = makeDate(y,m,d+1,eh);
    }
    copy.startDate = startDate;
    copy.endDate = endDate;
    return copy;
  }

  function makeDate(y,m,d,hDec){
    const hr = Math.floor(hDec); const min = Math.round((hDec-hr)*60);
    return new Date(y, m-1, d, hr, min, 0, 0);
  }

  /* ---------- Day Filter Bar ---------- */
  function ensureDayFilterBar(){
    if(dayBar) return;
    const hostSection = qs('#eventsSection');
    dayBar = ce('div');
    dayBar.id = 'eventsDayBar';
  dayBar.style.cssText = 'width:100%;max-width:var(--content-max);margin:0 auto .6rem;display:flex;align-items:center;gap:.55rem;overflow-x:auto;overflow-y:visible;scrollbar-width:none;-ms-overflow-style:none;padding:.55rem .55rem .6rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.18);border-radius:14px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-sizing:border-box;min-height:56px;';
    const hideStyle = document.getElementById('eventsDayBarHide') || document.createElement('style');
    hideStyle.id='eventsDayBarHide'; hideStyle.textContent='#eventsDayBar::-webkit-scrollbar{display:none;}';
    if(!document.getElementById('eventsDayBarHide')) document.head.appendChild(hideStyle);
    dayBar.addEventListener('wheel', e=>{ if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){ dayBar.scrollLeft+=e.deltaY; e.preventDefault(); }});
    dayBar.appendChild(buildDayBtn('All',''));
    dayBar.appendChild(buildDayBtn('Now','now'));
    DAY_ORDER.forEach(d=> dayBar.appendChild(buildDayBtn(cap(d.slice(0,3)), d)));
    const listContainer = qs('#eventList');
    (hostSection||document.body).insertBefore(dayBar, listContainer);
    setActiveDayBtn('');
  adjustDayBarAlignment();
  window.addEventListener('resize', debounce(adjustDayBarAlignment,150));
  }
  function buildDayBtn(label, val){
    const b = ce('button'); b.type='button'; b.textContent=label; b.dataset.day=val;
    b.style.cssText = dayBtnStyle();
    b.addEventListener('click', ()=>{ currentFilter = val; setActiveDayBtn(val); applyFilter(val); });
    return b;
  }
  function dayBtnStyle(){
    return [ 'flex:0 0 auto','padding:.45rem .8rem','font-size:.6rem','letter-spacing:.65px','text-transform:uppercase','border-radius:999px','border:1px solid rgba(255,255,255,0.18)','background:rgba(255,255,255,0.08)','color:#fff','cursor:pointer','font-weight:600','transition:background .25s,border-color .25s' ].join(';');
  }
  function setActiveDayBtn(val){
    if(!dayBar) return;
    [...dayBar.querySelectorAll('button')].forEach(btn=>{
      const active = btn.dataset.day === val;
      btn.style.background = active ? 'linear-gradient(135deg,#6a00ff,#8a33ff)' : 'rgba(255,255,255,0.08)';
      btn.style.borderColor = active ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)';
      btn.style.boxShadow = active ? '0 0 0 2px rgba(138,51,255,0.25)' : 'none';
    });
  // after selection UI might grow/shrink slightly; re-evaluate centering
  adjustDayBarAlignment();
  }

  /* ---------- Filtering & Rendering ---------- */
  function applyFilter(val){
    if(!container) return;
    const now = new Date();
    filtered = events.filter(ev=>{
      if(val === '' ) return true;
      if(val === 'now') return ev.startDate <= now && now < ev.endDate;
      return ev.day === val;
    });
    if(val === 'now'){
      filtered.sort((a,b)=> a.endDate - b.endDate); // soonest ending first
    } else {
      filtered.sort((a,b)=> a.startDate - b.startDate);
    }
    render();
  }

  function render(){
    container.innerHTML = '';
    if(!filtered.length){
      container.innerHTML = '<p class="caption" style="text-align:center;margin:.75rem 0;">No events</p>';
      return;
    }
    const frag = document.createDocumentFragment();
    filtered.forEach(ev=> {
      const row = buildRow(ev);
      row.addEventListener('click', ()=> openEventCard(ev));
      frag.appendChild(row);
    });
    container.appendChild(frag);
  }

  function buildRow(ev){
    const d = ce('div','sectionListItem');
    const now = new Date();
    const ongoing = ev.startDate <= now && now < ev.endDate;
  const dayLabel = cap(ev.day.slice(0,3));
  const fav = eventFavoriteSet.has(eventSlug(ev));
    d.innerHTML = `
      <div style="display:flex;flex-direction:row;align-items:stretch;gap:.9rem;width:100%;">
        <div style="flex:1;display:flex;flex-direction:column;min-height:100%;">
          <h3 style="margin:0 0 .25rem 0;font-size:.9rem;font-weight:600;line-height:1.2;display:flex;flex-wrap:wrap;align-items:center;gap:.45rem;">${escapeHTML(ev.name)} ${fav?'<span style=\"color:#fbbf24;\" title=\"Favorited\">★</span>':''} ${ongoing?'<span style=\"background:#15803d;color:#fff;font-size:.55rem;padding:.2rem .5rem;border-radius:999px;letter-spacing:.5px;text-transform:uppercase;\">Now</span>':''}</h3>
          <p style="margin:0 0 .3rem 0;font-size:.6rem;letter-spacing:.5px;text-transform:uppercase;display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;">
            <span style="background:#4b0082;padding:.18rem .55rem;border-radius:999px;color:#fff;">${dayLabel}</span>
            <span style="background:#222;padding:.18rem .55rem;border-radius:999px;color:#fff;">${formatRange(ev.startDate, ev.endDate)}</span>
          </p>
          <p style="margin:0;font-size:.65rem;color:#ddd;flex:0 0 auto;">${escapeHTML(ev.place||'')}</p>
          <div style="margin-top:auto;padding-top:.4rem;">
            <a href="${escapeAttr(ev.placeurl||'#')}" target="_blank" rel="noopener" style="color:#9fd4ff;font-size:.65rem;">Map / Details</a>
          </div>
        </div>
      </div>`;
    return d;
  }

  /* ---------- Utilities ---------- */
  function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
  function formatRange(start, end){ return formatHour(start)+' - '+formatHour(end); }
  function formatHour(dt){
    const hr = dt.getHours(); const min = dt.getMinutes();
    const period = hr>=12?'PM':'AM';
    const hr12 = ((hr+11)%12)+1;
    return hr12+':'+String(min).padStart(2,'0')+' '+period;
  }
  function escapeHTML(str){ return String(str||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c])); }
  function escapeAttr(str){ return escapeHTML(str); }

  function startNowTicker(){
    if(nowTimer) clearInterval(nowTimer);
    nowTimer = setInterval(()=>{
      if(currentFilter==='now'){ applyFilter('now'); }
      else if(container){ // just update badges cheaply
        // iterate rows and toggle Now badge
        const now = new Date();
        // re-render if any transition happened
        const wasOngoing = filtered.some(ev=> ev._ongoingCache);
        let changed = false;
        filtered.forEach(ev=>{
          const on = ev.startDate <= now && now < ev.endDate;
          if(on !== ev._ongoingCache){ changed = true; }
          ev._ongoingCache = on;
        });
        if(changed) render();
      }
    }, 60*1000); // every minute
  }

  /* ---------- Event Card & Favorites ---------- */
  function openEventCard(ev, hostOverride){
    let card = qs('#eventCard');
    const host = hostOverride || qs('#eventsSection') || document.body;
    if(!card){
      card = ce('div','panelCard');
      card.id='eventCard';
      host.appendChild(card);
    }
    const fav = eventFavoriteSet.has(eventSlug(ev));
    const status = computeEventStatus(ev);
    card.innerHTML = `
      <button class="closeButton" onclick="this.parentElement.remove()">✕</button>
      <h3 style="margin:0 0 .5rem 0;display:flex;align-items:center;gap:.5rem;">${escapeHTML(ev.name)} ${fav?'<span style=\"color:#fbbf24;\" title=\"Favorited\">★</span>':''}</h3>
      <p style="margin:.2rem 0 .15rem 0;font-size:.65rem;letter-spacing:.5px;text-transform:uppercase;display:flex;flex-wrap:wrap;gap:.45rem;">
        <span style="background:#4b0082;padding:.2rem .6rem;border-radius:999px;color:#fff;">${cap(ev.day)}</span>
        <span style="background:#222;padding:.2rem .6rem;border-radius:999px;color:#fff;">${formatRange(ev.startDate, ev.endDate)}</span>
        <span style="background:${status.bg};color:#fff;padding:.2rem .6rem;border-radius:999px;">${status.label}</span>
      </p>
      <p style="margin:.35rem 0 0 0;font-size:.75rem;color:#ddd;">${escapeHTML(ev.place||'')}</p>
      ${ev.placeurl?`<p style=\"margin:.35rem 0 0 0;\"><a href=\"${escapeAttr(ev.placeurl)}\" target=\"_blank\" rel=\"noopener\" style=\"color:#9fd4ff;\">Open Map</a></p>`:''}
      <button class="pageButton" style="margin-top:.85rem;" data-ev-fav-toggle>${fav?'★ Favorited':'☆ Add Favorite'}</button>
    `;
    const btn = card.querySelector('[data-ev-fav-toggle]');
    if(btn) btn.addEventListener('click', ()=> toggleEventFavorite(ev));
  }
  function computeEventStatus(ev){
    const now = new Date();
    if(now < ev.startDate) return { label:'Upcoming', bg:'linear-gradient(135deg,#0369a1,#0ea5e9)' };
    if(now >= ev.startDate && now < ev.endDate) return { label:'Now', bg:'linear-gradient(135deg,#15803d,#4ade80)' };
    return { label:'Ended', bg:'linear-gradient(135deg,#525252,#737373)' };
  }
  function eventSlug(ev){
    const y = ev.startDate.getFullYear();
    const m = String(ev.startDate.getMonth()+1).padStart(2,'0');
    const d = String(ev.startDate.getDate()).padStart(2,'0');
    return (y+m+d+'-'+(ev.name||'')).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  }
  function loadEventFavorites(){
    try { const raw = localStorage.getItem(EVENT_FAV_KEY); if(raw){ const arr=JSON.parse(raw); if(Array.isArray(arr)) eventFavoriteSet = new Set(arr); } } catch(e){ /* ignore */ }
  }
  function saveEventFavorites(){
    try { localStorage.setItem(EVENT_FAV_KEY, JSON.stringify([...eventFavoriteSet])); } catch(e){ }
  }
  function toggleEventFavorite(ev){
    const slug = eventSlug(ev);
    if(eventFavoriteSet.has(slug)) eventFavoriteSet.delete(slug); else eventFavoriteSet.add(slug);
    saveEventFavorites();
    updateEventFavoritesUI();
    applyFilter(currentFilter); // refresh stars
    const card = qs('#eventCard');
    if(card){ const b = card.querySelector('[data-ev-fav-toggle]'); if(b) b.textContent = eventFavoriteSet.has(slug)?'★ Favorited':'☆ Add Favorite'; }
  }
  function updateEventFavoritesUI(){
    const wrap = qs('#favoriteEvents');
    if(!wrap) return;
    const favEvents = events.filter(ev=> eventFavoriteSet.has(eventSlug(ev)));
    if(!favEvents.length){ wrap.innerHTML = '<p class="caption" style="margin:.5rem 0;">No favorite events yet</p>'; }
    else {
      const frag = document.createDocumentFragment();
      favEvents.sort((a,b)=> a.startDate - b.startDate).forEach(ev=>{
  const row = buildRow(ev);
  row.addEventListener('click', ()=> openEventCard(ev, qs('#favoritesSection')));
        frag.appendChild(row);
      });
      wrap.innerHTML='';
      wrap.appendChild(frag);
    }
    // badge if present
    const badge = document.getElementById('favoriteEventsBadge');
    if(badge) badge.textContent = String(favEvents.length);
  }

  /* ---------- Dynamic Alignment ---------- */
  function adjustDayBarAlignment(){
    if(!dayBar) return;
    // If total content width fits, center; else left align so scroll works naturally.
    const fits = dayBar.scrollWidth <= dayBar.clientWidth + 1; // small tolerance
    dayBar.style.justifyContent = fits ? 'center' : 'flex-start';
  }
  function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
