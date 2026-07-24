// places.js - dedicated Places logic (kept inside /jsonassets/ as requested)
// Loads places.json and icons.json (amenity icons) from same folder and renders into #placeList
// Minimal modular pattern without polluting global scope except window.Places

(function(){
  const DATA_URL = 'https://kahlaylae.github.io/RoamCMS/places.json';
  const IMAGE_BASE = 'https://kahlaylae.github.io/RoamCMS/images/';
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
      // Wire up modal close
      const modal = qs('#placeModal');
      const closeBtn = qs('#closeModal');
      if(modal){
        if(closeBtn) closeBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', e=>{ if(e.target===modal) closeModal(); });
        document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });
      }
    } catch(e){ console.error('places load failed', e); container.textContent = 'Unable to load places.'; }
  }

  /* ---------- UI Insertion ---------- */
  function ensureSearchBar(listContainer){
    if(qs('#placeSearch')){ searchInput = qs('#placeSearch'); attachSearchEvents(); return; }
    const hostSection = qs('#placesSection');
    const wrap = ce('div');
    // unified width with sectionList (full width constrained by var(--content-max))
    wrap.style.cssText = 'width:100%;margin:0 0 .6rem 0;display:flex;align-items:center;gap:.6rem;background:#eef5fa;border:1px solid rgba(30,111,159,0.2);padding:.55rem .85rem .6rem;border-radius:14px;box-sizing:border-box;';
    const icon = ce('span');
    icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1E6F9F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    searchInput = ce('input');
    searchInput.id = 'placeSearch';
    searchInput.type = 'search';
    searchInput.placeholder = 'Search places';
    searchInput.autocomplete = 'off';
    searchInput.setAttribute('aria-label','Search places');
    searchInput.style.cssText = 'flex:1;background:transparent;border:0;outline:none;font-size:.85rem;color:#1a2c3e;font-family:inherit;padding:.2rem;';

    // Location enable button
    locBtn = ce('button');
    locBtn.type = 'button';
    locBtn.id = 'locEnable';
    locBtn.textContent = 'Enable Location';
    locBtn.style.cssText = 'flex:0 0 auto;font-size:.6rem;letter-spacing:.7px;text-transform:uppercase;padding:.45rem .65rem;border-radius:9px;border:1px solid rgba(30,111,159,0.35);background:#e8f2f9;color:#1E6F9F;cursor:pointer;font-weight:700;display:flex;align-items:center;gap:.35rem;font-family:inherit;';
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
        locBtn.style.background = 'linear-gradient(135deg,#1E6F9F,#FF8C42)';
        locBtn.style.borderColor = '#1E6F9F';
        locBtn.style.color = '#fff';
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
    radiusBar.style.cssText = 'width:100%;margin:0 0 .6rem 0;display:flex;align-items:center;gap:.55rem;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;padding:.55rem .55rem .6rem;background:#eef5fa;border:1px solid rgba(30,111,159,0.2);border-radius:14px;box-sizing:border-box;';
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
    return [ 'flex:0 0 auto','padding:.45rem .8rem','font-size:.6rem','letter-spacing:.65px','text-transform:uppercase','border-radius:999px','border:1px solid rgba(30,111,159,0.3)','background:transparent','color:#1a2c3e','cursor:pointer','font-weight:600','transition:background .25s,border-color .25s','font-family:inherit' ].join(';');
  }
  function setActiveRadiusBtn(){
    if(!radiusBar) return;
    [...radiusBar.querySelectorAll('button')].forEach(btn=>{
      const val = btn.dataset.radius || null;
      const active = (val==null && radiusKm==null) || (val!=null && Number(val)===radiusKm);
      btn.style.background = active ? '#1E6F9F' : 'transparent';
      btn.style.color = active ? '#fff' : '#1a2c3e';
      btn.style.borderColor = active ? '#1E6F9F' : 'rgba(30,111,159,0.3)';
      btn.style.boxShadow = active ? '0 0 0 2px rgba(30,111,159,0.2)' : 'none';
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
    typeBar.style.cssText = 'width:100%;margin:0 0 .65rem 0;display:flex;align-items:center;gap:.5rem;overflow-x:auto;overflow-y:visible;padding:.6rem .55rem .65rem;scrollbar-width:none;-ms-overflow-style:none;background:#eef5fa;border:1px solid rgba(30,111,159,0.2);border-radius:14px;box-sizing:border-box;min-height:56px;';
    typeBar.setAttribute('role','tablist');
    typeBar.addEventListener('wheel', e=>{ if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){ typeBar.scrollLeft += e.deltaY; e.preventDefault(); }});
    const hideStyle = document.getElementById('placeTypeBarHide') || document.createElement('style');
    hideStyle.id = 'placeTypeBarHide';
    hideStyle.textContent = '#placeTypeBar::-webkit-scrollbar{display:none;}';
    if(!document.getElementById('placeTypeBarHide')) document.head.appendChild(hideStyle);
    const allBtn = buildTypeButton('All','');
    typeBar.appendChild(allBtn);
    types.forEach(t=> typeBar.appendChild(buildTypeButton(displayType(t), t)));
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
      'border:1px solid rgba(30,111,159,0.3)',
      'background:transparent',
      'color:#1a2c3e',
      'cursor:pointer',
      'font-weight:600',
      'transition:background .25s,border-color .25s',
      'font-family:inherit'
    ].join(';');
  }

  function setActiveTypeButton(val){
    if(!typeBar) return;
    [...typeBar.querySelectorAll('button')].forEach(b=>{
      const active = b.dataset.typeValue === val;
      b.style.background = active ? '#FF8C42' : 'transparent';
      b.style.color = active ? '#fff' : '#1a2c3e';
      b.style.borderColor = active ? '#FF8C42' : 'rgba(30,111,159,0.3)';
      b.style.boxShadow = active ? '0 0 0 2px rgba(255,140,66,0.2)' : 'none';
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
      closeModal();
      current = null;
    }
  }

  /* ---------- Rendering Grid ---------- */
  function render(container, list){
    container.innerHTML='';
    nodes = [];
    list.forEach(p=>{
      const d = ce('div','place-card');
      d.innerHTML = placeCardHTML(p);
      d.addEventListener('click', ()=> openModal(p));
      container.appendChild(d);
      nodes.push(d);
    });
  }

  /* ---------- Helpers ---------- */
  function displayType(type){
    const t = (type||'').trim();
    const map = { 'Gas':'Gas Station', 'Beach':'Beaches' };
    return map[t] || t;
  }
  function pickImage(p){
    const img = (p.image||'').trim();
    if(!img) return PLACEHOLDER_IMG;
    if(/^https?:\/\//i.test(img)) return img;
    if(img.startsWith('/')) return img;
    return IMAGE_BASE + img;
  }

  function placeCardHTML(p){
    const imgSrc = pickImage(p);
    const status = computeOpenStatus(p);
    const statusColor = status.state==='open' ? '#15803d' : (status.state==='closing' ? '#d97706' : '#dc2626');
    const fav = favoriteSet.has(placeSlug(p));
    const dist = renderDistance(p);
    return `
      <div class="place-img" style="background-image:url('${escapeHTML(imgSrc)}');"></div>
      <div class="place-info">
        <div class="place-title">${escapeHTML(p.title)}${fav?' <span style="color:#f59e0b;font-size:1rem;" title="Favorited">&#9733;</span>':''}</div>
        <span class="place-category">${escapeHTML(displayType(p.type)||p.label||'Place')}</span>
        <div class="place-footer">
          <span style="font-size:0.75rem;font-weight:600;color:${statusColor};">${escapeHTML(status.label)}</span>
          ${dist?`<span style="font-size:0.72rem;color:#6b7280;background:#f3f4f6;padding:.15rem .55rem;border-radius:999px;">${escapeHTML(dist)}</span>`:''}
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

  function openModal(p){
    current = p;
    const modal = qs('#placeModal');
    const body = qs('#modalBody');
    if(!modal || !body) return;
    const mapQuery = encodeURIComponent(`${p.title} ${p.location||''}`);
    const imgSrc = pickImage(p);
    const dist = renderDistance(p) || '';
    const hoursLine = buildHoursLine(p);
    const closedDays = (p.closedon||'').trim();
    const fav = favoriteSet.has(placeSlug(p));
    body.innerHTML = `
      <h2 id="modalTitle">${escapeHTML(p.title)}</h2>
      <img src="${escapeHTML(imgSrc)}" alt="${escapeHTML(p.title)}" style="width:100%;max-height:220px;object-fit:cover;border-radius:20px;margin:1rem 0;background:#eef2f5;" loading="lazy" onerror="this.src='${PLACEHOLDER_IMG}'" />
      <div class="detail-row">
        <p><strong>Location:</strong> ${escapeHTML(p.location||'N/A')}</p>
        ${p.type?`<p style="margin-top:.4rem;"><strong>Type:</strong> ${escapeHTML(displayType(p.type))}</p>`:''}
        <p style="margin-top:.4rem;"><strong>Status:</strong> ${escapeHTML(computeOpenStatus(p).label)}</p>
        ${hoursLine?`<p style="margin-top:.4rem;"><strong>Hours:</strong> ${escapeHTML(hoursLine)}</p>`:''}
        ${closedDays?`<p style="margin-top:.4rem;"><strong>Closed:</strong> ${escapeHTML(closedDays)}</p>`:''}
        ${dist?`<p style="margin-top:.4rem;"><strong>Distance:</strong> ${escapeHTML(dist)}</p>`:''}
      </div>
      ${amenities(p)}
      ${(p.phone||'').trim()?`<p style="margin:.8rem 0 0;"><strong>Phone:</strong> <a href="tel:${escapeHTML(p.phone.replace(/[^+0-9]/g,''))}" style="color:var(--blue);">${escapeHTML(p.phone)}</a></p>`:''}
      ${(p.website||'').trim()?`<p style="margin:.4rem 0 0;"><strong>Website:</strong> <a href="${escapeHTML(p.website)}" target="_blank" rel="noopener" style="color:var(--blue);">Visit Site &#8599;</a></p>`:''}
      <p style="margin:.4rem 0 0;"><a href="https://www.google.com/maps?q=${mapQuery}" target="_blank" rel="noopener" style="color:var(--blue);">View on Google Maps &#8599;</a></p>
      <button class="pageButton" style="margin-top:1.2rem;width:100%;" data-fav-toggle="1">${fav?'&#9733; Favorited':'&#9734; Add to Favorites'}</button>
    `;
    const favBtn = body.querySelector('[data-fav-toggle]');
    if(favBtn){ favBtn.addEventListener('click', ()=> toggleFavorite(p)); }
    modal.classList.add('active');
  }

  function closeModal(){
    const modal = qs('#placeModal');
    if(modal) modal.classList.remove('active');
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
    applyFilter(lastFilter); // refresh stars in grid
    const body = qs('#modalBody');
    if(body && current === p){
      const btn = body.querySelector('[data-fav-toggle]');
      if(btn) btn.innerHTML = favoriteSet.has(slug) ? '&#9733; Favorited' : '&#9734; Add to Favorites';
    }
  }
  function updateFavoritesUI(){
    const favWrap = qs('#favoritePlaces');
    if(!favWrap) return; // no favorites panel on this page
    const favItems = places.filter(p=> favoriteSet.has(placeSlug(p)));
    if(!favItems.length){
      favWrap.innerHTML = '<p style="color:#4a5568;font-size:.85rem;margin:.5rem 0;">No favorites yet</p>';
    } else {
      const frag = document.createDocumentFragment();
      favItems.forEach(p=>{
        const d = ce('div','place-card');
        d.innerHTML = placeCardHTML(p);
        d.addEventListener('click', ()=> openModal(p));
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
