// places.js - dedicated Places logic (kept inside /jsonassets/ as requested)
// Loads places.json and icons.json (amenity icons) from same folder and renders into #placeList
// Minimal modular pattern without polluting global scope except window.Places

(function(){
  const DATA_URL = '/jsonassets/places.json';
  const ICONS_URL = '/jsonassets/icons.json';
  const PLACEHOLDER_IMG = '/assets/placeholder.webp';
  let places = [];
  let amenityIcons = {}; // name -> {svg,title}
  let nodes = [];
  let current = null;
  let lastFilter = '';
  let searchInput = null;
  let debounceTimer = null;
  let currentTypeFilter = '';
  let typeBar = null;
  let userPos = null; // {lat, lon}
  let locBtn = null;
  let watchId = null;
  let radiusKm = null; // null = no radius filter
  let radiusBar = null;
  const FAVORITES_KEY = 'favorites_places_v1';
  let favoriteSet = new Set();

  window.Places = { init };

  function qs(sel,root=document){ return root.querySelector(sel); }
  function ce(tag, cls){ const el = document.createElement(tag); if(cls) el.className = cls; return el; }
  const nowLocal = ()=> new Date();

  async function init(){
    const container = qs('#placeList');
    if(!container) return;
    ensureSearchBar(container);
    container.textContent = 'Loading places...';
    try {
      const [iconsRes, placesRes] = await Promise.all([
        fetch(ICONS_URL, { cache:'no-store' }),
        fetch(DATA_URL, { cache:'no-store' })
      ]);
      if(!placesRes.ok) throw new Error('Places HTTP '+placesRes.status);
      if(iconsRes.ok){
        const iconArr = await iconsRes.json();
        iconArr.filter(i=> (i.type||'').toLowerCase()==='amenity')
               .forEach(i=> amenityIcons[i.name.toLowerCase()]={svg:i.svg,title:i.title||i.name});
      }
      places = await placesRes.json();
  loadFavorites();
      ensureTypeFilterBar(places, container);
      applyFilter('');
      injectSchema(places);
  updateFavoritesUI();
    } catch(e){ console.error('places load failed', e); container.textContent = 'Unable to load places.'; }
  }

  /* ---------- UI Insertion ---------- */
  function ensureSearchBar(listContainer){
    if(qs('#placeSearch')){ searchInput = qs('#placeSearch'); attachSearchEvents(); return; }
    const hostSection = qs('#placesSection');
    const wrap = ce('div');
    // unified width with sectionList (full width constrained by var(--content-max))
    wrap.style.cssText = 'width:100%;max-width:var(--content-max);margin:0 auto .45rem auto;display:flex;align-items:center;gap:.6rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);padding:.55rem .85rem .6rem;border-radius:14px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-sizing:border-box;';
    const icon = ce('span');
    icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ddd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    searchInput = ce('input');
    searchInput.id = 'placeSearch';
    searchInput.type = 'search';
    searchInput.placeholder = 'Search places';
    searchInput.autocomplete = 'off';
    searchInput.setAttribute('aria-label','Search places');
    searchInput.style.cssText = 'flex:1;background:transparent;border:0;outline:none;font-size:.85rem;color:#fff;font-family:inherit;padding:.2rem;';

    // Location enable button
    locBtn = ce('button');
    locBtn.type = 'button';
    locBtn.id = 'locEnable';
    locBtn.textContent = 'Enable Location';
    locBtn.style.cssText = 'flex:0 0 auto;font-size:.6rem;letter-spacing:.7px;text-transform:uppercase;padding:.45rem .65rem;border-radius:9px;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.12);color:#fff;cursor:pointer;font-weight:600;display:flex;align-items:center;gap:.35rem;';
    if(!('geolocation' in navigator)){
      locBtn.textContent = 'No Geo';
      locBtn.disabled = true;
      locBtn.style.opacity = .4;
    } else {
      locBtn.addEventListener('click', requestUserLocation);
    }

    wrap.appendChild(icon);
    wrap.appendChild(searchInput);
    wrap.appendChild(locBtn);
    (hostSection||document.body).insertBefore(wrap, listContainer);
    attachSearchEvents();
  }

  function requestUserLocation(){
    if(!('geolocation' in navigator)) return;
    locBtn.disabled = true;
    locBtn.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(
      pos=>{
        userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
        locBtn.textContent = 'Location On';
        locBtn.style.background = 'linear-gradient(135deg,#2563eb,#7c3aed)';
        locBtn.style.borderColor = 'rgba(255,255,255,0.5)';
        ensureRadiusBar();
        startWatchLocation();
        applyFilter(lastFilter);
        if(current) openCard(current);
      },
      err=>{
        console.warn('geo error', err);
        locBtn.disabled = false;
        locBtn.textContent = 'Retry Location';
      },
      { enableHighAccuracy:true, maximumAge:30000, timeout:10000 }
    );
  }
  function startWatchLocation(){
    if(!('geolocation' in navigator)) return;
    if(watchId!=null) return;
    watchId = navigator.geolocation.watchPosition(
      pos=>{
        userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
        // lightweight rerender distances only: rebuild list HTML (cheap for size) and card
        applyFilter(lastFilter);
        if(current) openCard(current);
      },
      err=> console.debug('watch error', err),
      { enableHighAccuracy:true, maximumAge:15000, timeout:15000 }
    );
  }
  function ensureRadiusBar(){
    if(radiusBar || !userPos) return;
    const hostSection = qs('#placesSection');
    const listContainer = qs('#placeList');
    radiusBar = ce('div');
    radiusBar.id = 'radiusFilterBar';
    radiusBar.style.cssText = 'width:100%;max-width:var(--content-max);margin:0 auto .6rem auto;display:flex;align-items:center;gap:.55rem;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;padding:.55rem .55rem .6rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.16);border-radius:14px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-sizing:border-box;';
    const hideStyle = document.getElementById('radiusHideStyle') || document.createElement('style');
    hideStyle.id='radiusHideStyle'; hideStyle.textContent='#radiusFilterBar::-webkit-scrollbar{display:none;}';
    if(!document.getElementById('radiusHideStyle')) document.head.appendChild(hideStyle);
    const options = [ ['All', null], ['1 km',1], ['5 km',5], ['10 km',10], ['25 km',25], ['50 km',50] ];
    options.forEach(([lab,val])=> radiusBar.appendChild(buildRadiusBtn(lab,val)) );
    (hostSection||document.body).insertBefore(radiusBar, listContainer); // place before list
    setActiveRadiusBtn();
  }
  function buildRadiusBtn(label, val){
    const b = ce('button');
    b.type='button';
    b.textContent = label;
    b.dataset.radius = val==null?'' : String(val);
    b.style.cssText = radiusBtnStyle();
    b.addEventListener('click', ()=>{
      radiusKm = (val==null? null : val);
      setActiveRadiusBtn();
      applyFilter(lastFilter);
    });
    return b;
  }
  function radiusBtnStyle(){
    return [ 'flex:0 0 auto','padding:.45rem .8rem','font-size:.6rem','letter-spacing:.65px','text-transform:uppercase','border-radius:999px','border:1px solid rgba(255,255,255,0.18)','background:rgba(255,255,255,0.08)','color:#fff','cursor:pointer','font-weight:600','transition:background .25s,border-color .25s' ].join(';');
  }
  function setActiveRadiusBtn(){
    if(!radiusBar) return;
    [...radiusBar.querySelectorAll('button')].forEach(btn=>{
      const val = btn.dataset.radius || null;
      const active = (val==null && radiusKm==null) || (val!=null && Number(val)===radiusKm);
      btn.style.background = active ? 'linear-gradient(135deg,#15803d,#4ade80)' : 'rgba(255,255,255,0.08)';
      btn.style.borderColor = active ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.18)';
      btn.style.boxShadow = active ? '0 0 0 2px rgba(34,197,94,0.25)' : 'none';
    });
  }

  /* ---------- Search Bar / Type Filter ---------- */
  function ensureTypeFilterBar(list, listContainer){
    if(typeBar) return;
    const hostSection = qs('#placesSection');
    const types = Array.from(new Set(list.map(p=> (p.type||'').trim()).filter(Boolean))).sort((a,b)=> a.localeCompare(b));
    if(!types.length) return; // nothing to build
    typeBar = ce('div');
    typeBar.id = 'placeTypeBar';
    typeBar.style.cssText = 'width:100%;max-width:var(--content-max);margin:0 auto .65rem auto;display:flex;align-items:center;gap:.5rem;overflow-x:auto;overflow-y:visible;padding:.6rem .55rem .65rem;scrollbar-width:none;-ms-overflow-style:none;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.18);border-radius:14px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-sizing:border-box;min-height:56px;';
    typeBar.setAttribute('role','tablist');
    typeBar.addEventListener('wheel', e=>{ if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){ typeBar.scrollLeft += e.deltaY; e.preventDefault(); }});
    const hideStyle = document.getElementById('placeTypeBarHide') || document.createElement('style');
    hideStyle.id = 'placeTypeBarHide';
    hideStyle.textContent = '#placeTypeBar::-webkit-scrollbar{display:none;}';
    if(!document.getElementById('placeTypeBarHide')) document.head.appendChild(hideStyle);
    const allBtn = buildTypeButton('All','');
    typeBar.appendChild(allBtn);
    types.forEach(t=> typeBar.appendChild(buildTypeButton(t, t)));
    (hostSection||document.body).insertBefore(typeBar, listContainer);
    setActiveTypeButton('');
  }

  function buildTypeButton(label, value){
    const btn = ce('button');
    btn.type='button';
    btn.textContent = label;
    btn.dataset.typeValue = value;
    btn.style.cssText = baseTypeBtnStyle();
    btn.addEventListener('click', ()=>{
      if(currentTypeFilter === value){ // toggle off
        currentTypeFilter = '';
        setActiveTypeButton('');
      } else {
        currentTypeFilter = value;
        setActiveTypeButton(value);
      }
      applyFilter(lastFilter);
    });
    return btn;
  }

  function baseTypeBtnStyle(){
    return [
      'flex:0 0 auto',
      'padding:.45rem .85rem',
      'font-size:.65rem',
      'letter-spacing:.7px',
      'text-transform:uppercase',
      'border-radius:999px',
      'border:1px solid rgba(255,255,255,0.18)',
      'background:rgba(255,255,255,0.08)',
      'color:#fff',
      'cursor:pointer',
      'font-weight:600',
      'transition:background .25s,border-color .25s',
      'backdrop-filter:blur(4px)',
      '-webkit-backdrop-filter:blur(4px)'
    ].join(';');
  }

  function setActiveTypeButton(val){
    if(!typeBar) return;
    [...typeBar.querySelectorAll('button')].forEach(b=>{
      const active = b.dataset.typeValue === val;
      b.style.background = active ? 'linear-gradient(135deg,#6a00ff,#8a33ff)' : 'rgba(255,255,255,0.08)';
      b.style.borderColor = active ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)';
      b.style.boxShadow = active ? '0 0 0 2px rgba(138,51,255,0.25)' : 'none';
    });
  }

  /* ---------- Search Events ---------- */
  function attachSearchEvents(){
    if(!searchInput) return;
    searchInput.addEventListener('input', ()=>{
      const term = searchInput.value.trim();
      if(term===lastFilter) return;
      lastFilter = term;
      if(debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(()=> applyFilter(term), 90);
    });
    searchInput.addEventListener('keydown', e=>{
      if(e.key==='Escape'){ searchInput.value=''; lastFilter=''; applyFilter(''); searchInput.blur(); }
    });
  }

  /* ---------- Filtering ---------- */
  function applyFilter(term){
    const container = qs('#placeList');
    if(!container) return;
    const searchTerm = (term||'').toLowerCase();
    let filtered = places.filter(p=> {
      if(currentTypeFilter && (p.type||'') !== currentTypeFilter) return false;
      if(searchTerm && !matchPlace(p, searchTerm)) return false;
      if(radiusKm!=null && userPos && typeof p.latitude==='number' && typeof p.longitude==='number'){
        const d = haversine(userPos.lat, userPos.lon, p.latitude, p.longitude);
        if(d > radiusKm) return false;
      }
      return true;
    });
    if(userPos){
      filtered = filtered.slice().sort((a,b)=>{
        const da = (typeof a.latitude==='number' && typeof a.longitude==='number') ? haversine(userPos.lat,userPos.lon,a.latitude,a.longitude) : Infinity;
        const db = (typeof b.latitude==='number' && typeof b.longitude==='number') ? haversine(userPos.lat,userPos.lon,b.latitude,b.longitude) : Infinity;
        return da - db;
      });
    }
    if(!filtered.length){
      container.innerHTML = '<p class="caption" style="text-align:center;margin:.75rem 0;">No matches</p>';
      nodes = [];
      if(current) closeIfFilteredOut(current, filtered);
      return;
    }
    render(container, filtered);
    if(current) closeIfFilteredOut(current, filtered);
  }

  function matchPlace(p, term){
    const parts = [p.title, p.type, p.location, p.tags, p.description];
    return parts.some(v=> v && String(v).toLowerCase().includes(term));
  }

  function closeIfFilteredOut(place, list){
    if(!list.some(x=> x===place)){
      const card = qs('#placeCard');
      if(card) card.remove();
      current = null;
    }
  }

  /* ---------- Rendering List ---------- */
  function render(container, list){
    container.innerHTML='';
    nodes = [];
    list.forEach(p=>{
      const d = ce('div','sectionListItem');
      d.innerHTML = placeRowHTML(p);
      d.addEventListener('click', ()=> openCard(p));
      container.appendChild(d);
      nodes.push(d);
    });
  }

  /* ---------- Helpers ---------- */
  function pickImage(p){
    const img = (p.image||'').trim();
    if(!img) return PLACEHOLDER_IMG;
    if(/^https?:\/\//i.test(img)) return img;
    if(img.startsWith('/')) return img;
    return img.includes('/') ? '/' + img : '/assets/' + img;
  }

  function placeRowHTML(p){
    const status = computeOpenStatus(p);
    const statusColor = status.state==='open' ? '#4ade80' : (status.state==='closing' ? '#fbbf24' : '#f87171');
    const imgSrc = pickImage(p);
    const dist = renderDistance(p);
  const fav = favoriteSet.has(placeSlug(p));
    return `
      <div style="display:flex;flex-direction:row;align-items:flex-start;gap:.75rem;width:100%;">
        <div style="flex:0 0 auto;display:flex;align-items:center;justify-content:center;">
          <img src="${imgSrc}" alt="${escapeHTML(p.title)}" style="width:70px;height:70px;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:#222;" loading="lazy" onerror="this.src='${PLACEHOLDER_IMG}'" />
        </div>
        <div style="display:flex;flex-direction:column;flex:1;min-width:0;">
      <h3 style="margin:0 0 .25rem 0;font-size:.95rem;font-weight:600;line-height:1.15;color:#fff;display:flex;align-items:center;gap:.4rem;">${escapeHTML(p.title)}${fav?'<span style=\"color:#fbbf24;font-size:.8rem;\" title=\"Favorited\">★</span>':''}</h3>
          <p style="margin:0 0 .15rem 0;display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;font-size:.6rem;letter-spacing:.5px;text-transform:uppercase;">
            ${p.type?`<span style=\"background:#4b0082;padding:.15rem .5rem;border-radius:999px;color:#fff;\">${escapeHTML(p.type)}</span>`:''}
            <span style="color:${statusColor};font-weight:600;">${status.label}</span>
            ${dist?`<span style=\"background:#222;padding:.15rem .5rem;border-radius:999px;color:#fff;\">${dist}</span>`:''}
          </p>
          <p style="margin:0;font-size:.65rem;color:#ddd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">${escapeHTML(p.location||'')}</p>
          <div style="margin-top:.45rem;display:flex;flex-wrap:wrap;gap:.4rem;">${miniAmenityIcons(p,6)}</div>
        </div>
      </div>`;
  }

  function computeOpenStatus(p){
    const open = p.open; const close = p.closes; const closedon = (p.closedon||'').toLowerCase();
    if(open==null || close==null) return { state:'unknown', label:'Hours N/A' };
    const now = nowLocal();
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const dayName = dayNames[now.getDay()];
    if(closedon && closedon.includes(dayName)) return { state:'closed', label:'Closed Today' };
    const minutesNow = now.getHours() + now.getMinutes()/60;
    if(open===close) return { state:'open', label:'Open 24h' };
    const isOpen = minutesNow >= open && minutesNow < close;
    if(!isOpen) return { state:'closed', label:`Opens ${formatHour(open)}` };
    const hoursLeft = close - minutesNow;
    if(hoursLeft <= 0.5) return { state:'closing', label:'Closing Soon' };
    return { state:'open', label:`Open · Closes ${formatHour(close)}` };
  }

  function formatHour(h){ const hr=Math.floor(h); const min=Math.round((h-hr)*60); const period=hr>=12?'PM':'AM'; const hr12=((hr+11)%12)+1; return `${hr12}:${String(min).padStart(2,'0')} ${period}`; }

  function miniAmenityIcons(p, limit){
    const tagsStr = (p.tags||'').toLowerCase(); if(!tagsStr) return '';
    const tagTokens = tagsStr.split(/[\s,]+/).filter(Boolean);
    const seen = new Set();
    const icons=[];
    for(const tok of tagTokens){
      if(amenityIcons[tok] && !seen.has(tok)){
        icons.push(`<span title="${amenityIcons[tok].title}" style="display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center;">${amenityIcons[tok].svg}</span>`);
        seen.add(tok);
        if(limit && icons.length>=limit) break;
      }
    }
    return icons.join('');
  }

  function openCard(p, hostOverride){
    current = p;
    let card = qs('#placeCard');
    const hostSection = hostOverride || qs('#placesSection');
    if(!card){
      card = ce('div','panelCard');
      card.id='placeCard';
      (hostSection||document.body).appendChild(card);
    }
    const mapQuery = encodeURIComponent(`${p.title} ${p.location||''}`);
    const imgSrc = pickImage(p);
    const dist = renderDistance(p) || '';
    const hoursLine = buildHoursLine(p);
    const closedDays = (p.closedon||'').trim();
    const fav = favoriteSet.has(placeSlug(p));
    card.innerHTML = `
      <button class=\"closeButton\" onclick=\"this.parentElement.remove()\">✕</button>
      <h3 style=\"margin:0 0 .5rem 0;\">${escapeHTML(p.title)}</h3>
      <img src=\"${imgSrc}\" alt=\"${escapeHTML(p.title)}\" style=\"width:100%;height:auto;max-height:220px;object-fit:cover;border-radius:14px;border:1px solid rgba(255,255,255,0.15);background:#222;\" loading=\"lazy\" onerror=\"this.src='${PLACEHOLDER_IMG}'\" />
      <p style=\"margin:.5rem 0 .15rem 0;\"><strong>Location:</strong> ${escapeHTML(p.location||'N/A')}</p>
      ${p.type?`<p style=\\"margin:.15rem 0;\\"><strong>Type:</strong> ${escapeHTML(p.type)}</p>`:''}
      <p style=\"margin:.15rem 0;\"><strong>Status:</strong> ${computeOpenStatus(p).label}</p>
      ${hoursLine?`<p style=\\"margin:.15rem 0;\\"><strong>Hours:</strong> ${hoursLine}</p>`:''}
      ${closedDays?`<p style=\\"margin:.15rem 0;\\"><strong>Closed:</strong> ${escapeHTML(closedDays)}</p>`:''}
      ${dist?`<p style=\\"margin:.15rem 0;\\"><strong>Distance:</strong> ${dist}</p>`:''}
      <iframe src=\"https://www.google.com/maps?q=${mapQuery}&output=embed\" loading=\"lazy\" style=\"width:100%;min-height:180px;border:0;border-radius:10px;margin: .5rem 0 0 0;\"></iframe>
      ${amenities(p)}
  ${(p.phone||'').trim()?`<p style=\\"margin:.6rem 0 0 0;\\"><strong>Phone:</strong> <a href=\\"tel:${p.phone.replace(/[^+0-9]/g,'')}\\" style=\\"color:#9fd4ff;\\">${escapeHTML(p.phone)}</a></p>`:''}
  ${(p.website||'').trim()?`<p style=\\"margin:.35rem 0 0 0;\\"><strong>Website:</strong> <a href=\\"${escapeHTML(p.website)}\\" target=\\"_blank\\" rel=\\"noopener\\" style=\\"color:#9fd4ff;\\">Visit Site</a></p>`:''}
      <button class=\"pageButton\" style=\"margin-top:.75rem;\" data-fav-toggle=\"1\">${fav?'★ Favorited':'☆ Add Favorite'}</button>
    `;
    const favBtn = card.querySelector('[data-fav-toggle]');
    if(favBtn){ favBtn.addEventListener('click', ()=> toggleFavorite(p)); }
  }
  function buildHoursLine(p){
    const o = p.open; const c = p.closes;
    if(typeof o !== 'number' || typeof c !== 'number') return '';
    if(o===c) return 'Open 24h';
    return `${formatHour(o)} - ${formatHour(c)}`;
  }

  /* ---------- Distance ---------- */
  function renderDistance(p){
    if(!userPos) return '';
    if(typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return '';
    const dKm = haversine(userPos.lat, userPos.lon, p.latitude, p.longitude);
    if(dKm < 1) return `${Math.round(dKm * 1000)} m`;
    if(dKm < 10) return `${dKm.toFixed(1)} km`;
    return `${Math.round(dKm)} km`;
  }

  function haversine(lat1, lon1, lat2, lon2){
    const R = 6371; // km
    const toRad = x => x * Math.PI/180;
    const dLat = toRad(lat2-lat1);
    const dLon = toRad(lon2-lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  /* ---------- Amenities / Schema / Utils ---------- */
  function amenities(p){
    const tagsStr = (p.tags||'').toLowerCase();
    if(!tagsStr) return '<div class="amenitiesBlock"><p class="amenitiesLabel">Amenities</p><p class="caption" style="margin:0;">No amenities listed</p></div>';
    const tagTokens = tagsStr.split(/[\s,]+/).filter(Boolean);
    const matched = [];
    const seen = new Set();
    tagTokens.forEach(tok=>{
      const iconObj = amenityIcons[tok];
      if(iconObj && !seen.has(tok)){
        matched.push(`<span class=\"amenity-icon\" title=\"${iconObj.title}\" style=\"display:inline-flex;flex-direction:column;align-items:center;font-size:.85rem;gap:2px;\">${iconObj.svg}<span style=\"font-size:.55rem;line-height:1.1;letter-spacing:.3px;max-width:48px;text-align:center;overflow:hidden;text-overflow:ellipsis;\">${iconObj.title}</span></span>`);
        seen.add(tok);
      }
    });
    if(!matched.length) return '<div class="amenitiesBlock"><p class="amenitiesLabel">Amenities</p><p class="caption" style="margin:0;">No amenities available</p></div>';
    return `<div class=\"amenitiesBlock\"><p class=\"amenitiesLabel\">Amenities</p><div class=\"amenitiesIcons\">${matched.join('')}</div></div>`;
  }

  function injectSchema(all){
    try { if(qs('#places-schema')) return; const subset = all.slice(0,10).map(p=>({'@context':'https://schema.org','@type':['TouristAttraction','Place','LocalBusiness'],name:p.title,address:{'@type':'PostalAddress', addressLocality:p.location||''},geo:(p.latitude&&p.longitude)?{'@type':'GeoCoordinates', latitude:p.latitude, longitude:p.longitude}:undefined,url:p.googleurl||'',description:`Discover ${p.title} in Anguilla`})); const itemList={ '@context':'https://schema.org','@type':'ItemList', name:'Featured Places in Anguilla', itemListElement: subset.map((it,i)=>({'@type':'ListItem', position:i+1, item:it}))}; const s=ce('script'); s.type='application/ld+json'; s.id='places-schema'; s.textContent=JSON.stringify(itemList); document.head.appendChild(s);} catch(err){ console.warn('schema fail', err); }
  }

  function escapeHTML(str){ return String(str).replace(/[&<>\"]/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[s])); }

  /* ---------- Favorites Logic (re-added) ---------- */
  function placeSlug(p){
    if(p.slug) return p.slug;
    return (p.title||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  }
  function loadFavorites(){
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if(raw){
        const arr = JSON.parse(raw);
        if(Array.isArray(arr)) favoriteSet = new Set(arr);
      }
    } catch(e){ console.warn('loadFavorites fail', e); }
  }
  function saveFavorites(){
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteSet])); } catch(e){ /* ignore */ }
  }
  function toggleFavorite(p){
    const slug = placeSlug(p);
    if(favoriteSet.has(slug)) favoriteSet.delete(slug); else favoriteSet.add(slug);
    saveFavorites();
    updateFavoritesUI();
    applyFilter(lastFilter); // refresh stars in main list
    const card = qs('#placeCard');
    if(card){
      const btn = card.querySelector('[data-fav-toggle]');
      if(btn) btn.textContent = favoriteSet.has(slug) ? '★ Favorited' : '☆ Add Favorite';
    }
  }
  function updateFavoritesUI(){
    const favWrap = qs('#favoritePlaces');
    if(!favWrap) return;
    const favItems = places.filter(p=> favoriteSet.has(placeSlug(p)));
    if(!favItems.length){
      favWrap.innerHTML = '<p class="caption" style="margin:.5rem 0;">No favorites yet</p>';
    } else {
      const frag = document.createDocumentFragment();
      favItems.forEach(p=>{
  const d = ce('div','sectionListItem');
  d.innerHTML = placeRowHTML(p);
  d.addEventListener('click', ()=> openCard(p, qs('#favoritesSection')));
        frag.appendChild(d);
      });
      favWrap.innerHTML='';
      favWrap.appendChild(frag);
    }
    const badge = qs('#favoritesBadge');
    if(badge) badge.textContent = String(favItems.length);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
