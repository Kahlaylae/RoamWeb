// ratings.js — Firestore-backed place rating system for RoamWeb
// Matches the iOS app's RatingService: collection "placeRatings", aggregate docs {totalRating, count}
// Device tracking via cookie — no sign-in required.
(function(){
  'use strict';

  // ── Firebase config (matches iOS app) ──
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDODDR1_ALzEPNqPqbmemX7k_3mUxz8Bjg",
    authDomain: "roamios-1488d.firebaseapp.com",
    projectId: "roamios-1488d",
    storageBucket: "roamios-1488d.firebasestorage.app",
    appId: "1:11300058795:web:roamweb"
  };

  const COLLECTION = "placeRatings";
  const COOKIE_NAME = "roam_device_id";
  const RATED_COOKIE = "roam_rated";
  const COOKIE_DAYS = 365;

  // ── State ──
  let db = null;
  let deviceId = null;
  let ratedMap = {};        // { placeId: ratingValue }
  let aggregateCache = {};  // { placeId: {totalRating, count} }

  // ── Helpers ──
  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  }
  function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = name + '=' + encodeURIComponent(value) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }
  function generateId() {
    return 'rw_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  // SHA-256 of "title|location" — matches iOS app's Place.id generation
  async function placeId(place) {
    if (place.id) return place.id;
    var raw = (place.title || '') + '|' + (place.location || '');
    raw = raw.toLowerCase();
    var msgBuffer = new TextEncoder().encode(raw);
    var hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Init ──
  async function init() {
    // Get or create device ID
    deviceId = getCookie(COOKIE_NAME);
    if (!deviceId) {
      deviceId = generateId();
      setCookie(COOKIE_NAME, deviceId, COOKIE_DAYS);
    }

    // Load previously rated places from cookie
    const raw = getCookie(RATED_COOKIE);
    if (raw) {
      try { ratedMap = JSON.parse(raw); } catch(e) { ratedMap = {}; }
    }

    // Load Firebase (if not already loaded)
    if (typeof firebase === 'undefined') {
      // Firebase is loaded via CDN script tag — wait for it
      await new Promise((resolve, reject) => {
        const check = () => {
          if (typeof firebase !== 'undefined' && firebase.firestore) {
            resolve();
          } else {
            setTimeout(check, 100);
          }
        };
        setTimeout(() => reject(new Error('Firebase not loaded')), 10000);
        check();
      });
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    db = firebase.firestore();

    console.log('⭐ Ratings ready — device:', deviceId);
  }

  function saveRatedCookie() {
    setCookie(RATED_COOKIE, JSON.stringify(ratedMap), COOKIE_DAYS);
  }

  // ── Fetch aggregate rating for a single place ──
  async function fetchAggregate(placeId) {
    if (!db) await init();
    if (aggregateCache[placeId]) return aggregateCache[placeId];

    try {
      const doc = await db.collection(COLLECTION).doc(placeId).get();
      if (doc.exists) {
        const data = doc.data();
        const agg = { totalRating: data.totalRating || 0, count: data.count || 0 };
        aggregateCache[placeId] = agg;
        return agg;
      }
    } catch(e) {
      console.warn('Rating fetch failed for', placeId, e);
    }
    return null;
  }

  // ── Fetch aggregates for multiple places ──
  async function fetchAggregates(placeIds) {
    if (!db) await init();
    const unique = [...new Set(placeIds)].filter(id => !aggregateCache[id]);
    if (!unique.length) return;

    // Firestore can fetch up to 10 docs at once with 'in' query
    for (let i = 0; i < unique.length; i += 10) {
      const batch = unique.slice(i, i + 10);
      try {
        const snapshot = await db.collection(COLLECTION)
          .where(firebase.firestore.FieldPath.documentId(), 'in', batch)
          .get();
        snapshot.forEach(doc => {
          const data = doc.data();
          aggregateCache[doc.id] = { totalRating: data.totalRating || 0, count: data.count || 0 };
        });
      } catch(e) {
        // Fallback: fetch individually
        for (const id of batch) {
          try {
            const doc = await db.collection(COLLECTION).doc(id).get();
            if (doc.exists) {
              const data = doc.data();
              aggregateCache[id] = { totalRating: data.totalRating || 0, count: data.count || 0 };
            }
          } catch(e2) { /* skip */ }
        }
      }
    }
  }

  // ── Submit a rating ──
  async function ratePlace(placeId, rating) {
    if (!db) await init();
    if (rating < 1 || rating > 5) return;

    const oldRating = ratedMap[placeId] || 0;
    ratedMap[placeId] = rating;
    saveRatedCookie();

    try {
      await db.collection(COLLECTION).doc(placeId).set({
        totalRating: firebase.firestore.FieldValue.increment(rating - oldRating),
        count: oldRating ? firebase.firestore.FieldValue.increment(0) : firebase.firestore.FieldValue.increment(1)
      }, { merge: true });

      // Also save per-device rating
      await db.collection(COLLECTION).doc(placeId).collection('ratings').doc(deviceId).set({
        rating: rating,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      // Clear cache
      delete aggregateCache[placeId];
      return true;
    } catch(e) {
      console.error('Rating submit failed', e);
      // Rollback local state
      if (oldRating) ratedMap[placeId] = oldRating;
      else delete ratedMap[placeId];
      saveRatedCookie();
      return false;
    }
  }

  // ── Get my rating for a place ──
  function myRating(placeId) {
    return ratedMap[placeId] || 0;
  }

  // ── Render star rating HTML ──
  function renderStars(placeId, opts = {}) {
    const agg = aggregateCache[placeId];
    const my = myRating(placeId);
    const avg = agg && agg.count > 0 ? (agg.totalRating / agg.count) : 0;
    const count = agg ? agg.count : 0;
    const interactive = opts.interactive !== false;

    let html = '<span class="rating-stars" data-place-id="' + placeId + '"';
    if (interactive) html += ' style="cursor:pointer"';
    html += '>';

    for (let i = 1; i <= 5; i++) {
      const filled = i <= Math.round(avg);
      const myFill = my && i <= my;
      let cls = 'rating-star';
      if (myFill) cls += ' my-rating';
      else if (filled) cls += ' filled';
      html += '<span class="' + cls + '" data-value="' + i + '">' + (filled || myFill ? '★' : '☆') + '</span>';
    }

    html += '</span>';
    if (count > 0) {
      html += ' <span class="rating-count">(' + count + ')</span>';
    }
    return html;
  }

  // ── Attach click handlers to star ratings ──
  function attachStarClicks(container) {
    if (!container) container = document;
    container.querySelectorAll('.rating-stars[style*="cursor:pointer"], .rating-stars:not([style])').forEach(el => {
      if (el.dataset.bound) return;
      el.dataset.bound = '1';
      const placeId = el.dataset.placeId;
      el.querySelectorAll('.rating-star').forEach(star => {
        star.addEventListener('click', async function(e) {
          e.preventDefault();
          e.stopPropagation();
          const value = parseInt(this.dataset.value);
          const success = await ratePlace(placeId, value);
          if (success) {
            refreshStarsUI(placeId, el);
          }
        });
        star.addEventListener('mouseenter', function() {
          previewStars(el, parseInt(this.dataset.value));
        });
      });
      el.addEventListener('mouseleave', function() {
        refreshStarsUI(placeId, el);
      });
    });
  }

  function previewStars(container, upTo) {
    container.querySelectorAll('.rating-star').forEach((s, i) => {
      s.textContent = i < upTo ? '★' : '☆';
    });
  }

  function refreshStarsUI(placeId, container) {
    const agg = aggregateCache[placeId];
    const avg = agg && agg.count > 0 ? (agg.totalRating / agg.count) : 0;
    const my = myRating(placeId);
    container.querySelectorAll('.rating-star').forEach((s, i) => {
      const val = i + 1;
      s.textContent = (val <= Math.round(avg) || (my && val <= my)) ? '★' : '☆';
      s.className = 'rating-star';
      if (my && val <= my) s.className += ' my-rating';
      else if (val <= Math.round(avg)) s.className += ' filled';
    });
    const countEl = container.parentElement.querySelector('.rating-count');
    if (countEl && aggregateCache[placeId]) {
      countEl.textContent = '(' + aggregateCache[placeId].count + ')';
    }
  }

  // ── Inject rating CSS once ──
  function injectCSS() {
    if (document.getElementById('ratings-css')) return;
    const style = document.createElement('style');
    style.id = 'ratings-css';
    style.textContent = `
      .rating-stars { display: inline-flex; gap: 2px; align-items: center; }
      .rating-star { color: #ccc; font-size: 1rem; transition: color 0.15s; user-select: none; }
      .rating-star.filled { color: #f59e0b; }
      .rating-star.my-rating { color: #e67e00; }
      .rating-stars[style*="cursor:pointer"] .rating-star:hover,
      .rating-stars:not([style]) .rating-star:hover { color: #f59e0b; transform: scale(1.2); }
      .rating-count { font-size: 0.75rem; color: #888; margin-left: 4px; }
    `;
    document.head.appendChild(style);
  }

  // ── Public API ──
  window.RoamRatings = {
    init,
    fetchAggregate,
    fetchAggregates,
    ratePlace,
    myRating,
    renderStars,
    attachStarClicks,
    injectCSS,
    placeId,
    get deviceId() { return deviceId; },
    get aggregateCache() { return aggregateCache; },
    get ratedMap() { return ratedMap; }
  };

  // Auto-init when DOM is ready
  if (document.readyState !== 'loading') {
    injectCSS();
  } else {
    document.addEventListener('DOMContentLoaded', injectCSS);
  }
})();
