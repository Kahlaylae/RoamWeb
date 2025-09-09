// Dynamic navigation builder with mobile icon mode
(async function(){
  const nav = document.getElementById('mainNav');
  const scroller = document.getElementById('mainContent');
  if(!nav || !scroller) return;

  const sectionsConfig = [
    { id: 'placesSection', label: 'Places', iconKey: 'home' },
    { id: 'eventsSection', label: 'Events', iconKey: 'events' },
    { id: 'favoritesSection', label: 'Favorites', iconKey: 'favorite' },
    { id: 'blogSection', label: 'Blog', iconKey: 'blog' },
    { id: 'downloadSection', label: 'Download', iconKey: 'download' }
  ];
  const LS_ACTIVE_KEY = 'nav_last_active_v1';

  // Load icons JSON once
  let icons = [];
  try {
    const res = await fetch('/jsonassets/icons.json');
    if(res.ok) icons = await res.json();
  } catch(e){ console.warn('Icon load failed', e); }
  const navIconMap = Object.fromEntries(
    icons.filter(i=> i.type === 'Navigation').map(i=> [i.name, i.svg])
  );

  // Build links
  const frag = document.createDocumentFragment();
  sectionsConfig.forEach(cfg=>{
    const a = document.createElement('a');
    a.href = `#${cfg.id}`;
    a.dataset.target = cfg.id;
    a.setAttribute('data-label', cfg.label);
    a.innerHTML = `<span class="nav-icon">${navIconMap[cfg.iconKey]||''}</span><h1 class="nav-label">${cfg.label}</h1>`;
    frag.appendChild(a);
  });
  nav.appendChild(frag);

  const links = Array.from(nav.querySelectorAll('a[data-target]'));
  const sections = links.map(l=> document.getElementById(l.dataset.target)).filter(Boolean);
  let manual=false; let manualTimer;

  function setActive(id){
    links.forEach(a=>{
      const active = a.dataset.target===id;
      a.classList.toggle('active', active);
      if(active){
        a.setAttribute('aria-current','true');
      } else a.removeAttribute('aria-current');
    });
    const activeEl = links.find(a=> a.classList.contains('active'));
    if(activeEl){
      const desiredLeft = activeEl.offsetLeft - (nav.clientWidth/2 - activeEl.offsetWidth/2);
      const clamped = Math.max(0, Math.min(desiredLeft, nav.scrollWidth - nav.clientWidth));
      nav.scrollTo({left: clamped, behavior:'smooth'});
  try { localStorage.setItem(LS_ACTIVE_KEY, id); } catch(e){}
    }
  }

  const observer = new IntersectionObserver(entries=>{
    if(manual) return;
    let best=null;
    entries.forEach(e=>{ if(e.isIntersecting){ if(!best) best=e; else if(e.intersectionRatio>best.intersectionRatio) best=e; }});
    if(best) setActive(best.target.id);
  }, { root: scroller, threshold:[0.25,0.5,0.75] });
  sections.forEach(sec=> observer.observe(sec));

  links.forEach(a=> a.addEventListener('click', e=>{
    e.preventDefault();
    const id = a.dataset.target; const target=document.getElementById(id); if(!target) return;
    manual=true; clearTimeout(manualTimer);
    setActive(id);
    target.scrollIntoView({behavior:'smooth', block:'start'});
    manualTimer=setTimeout(()=> manual=false, 900);
  }));

  // Restore last active section if available
  let initial = sections[0]?.id || '';
  try {
    const saved = localStorage.getItem(LS_ACTIVE_KEY);
    if(saved && document.getElementById(saved)) initial = saved;
  } catch(e){}
  setActive(initial);
  // Scroll that section into view after layout so observer picks it up naturally
  requestAnimationFrame(()=>{
    const target = document.getElementById(initial);
    if(target) target.scrollIntoView({behavior:'auto', block:'start'});
  });
})();
