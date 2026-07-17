// openstatus.js — mirrors iOS app's Place open/close logic
// Ported from 4.PlaceDetails.swift (isCurrentlyOpen, isOpenNow, isClosedToday, closedDays, isOutdoorPOI)
(function(){
  'use strict';

  const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

  // ── Helpers ──
  function getToday() {
    return DAY_NAMES[new Date().getDay()];
  }

  function currentTime() {
    const now = new Date();
    return now.getHours() + (now.getMinutes() / 60.0);
  }

  // ── closedDays (mirrors Place.swift closedDays computed property) ──
  function computeClosedDays(closedon) {
    const text = (closedon || '').toLowerCase().trim();
    if (!text) return [];

    // "Open Daily" / "open 7 days" → never closed
    if (text.includes('open daily') || text.includes('open 7 days') || text.startsWith('24')) {
      return [];
    }

    // "By Appointment Only" or similar → not closed, just irregular
    if (text.includes('by appointment') || text.includes('call for hours')) {
      return [];
    }

    const closed = [];

    // Split into clauses by period
    const clauses = text.split('.').map(c => c.trim()).filter(c => c);

    for (const clause of clauses) {
      // "closed sunday" / "closed sunday, monday"
      if (clause.startsWith('closed')) {
        for (const day of DAY_NAMES) {
          if (clause.includes(day) && !closed.includes(day)) closed.push(day);
        }
      }

      // "until 10.50pm friday, saturday" → late closing, NOT closed days
      if (clause.startsWith('until')) {
        for (const day of DAY_NAMES) {
          const idx = closed.indexOf(day);
          if (idx !== -1) closed.splice(idx, 1);
        }
      }

      // "open sunday" → explicitly open that day
      if (clause.startsWith('open') && !clause.includes('daily')) {
        for (const day of DAY_NAMES) {
          const idx = closed.indexOf(day);
          if (idx !== -1 && clause.includes(day)) closed.splice(idx, 1);
        }
      }
    }

    // If no "closed" clause at all, nothing is closed
    if (!text.includes('closed')) return [];

    return closed;
  }

  function isClosedDay(closedon, day) {
    return computeClosedDays(closedon).includes(day);
  }

  // ── Individual checks ──

  function isOutdoorPOI(place) {
    const type = (place.type || '').toLowerCase();
    return ['beach', 'landmark', 'park'].some(kw => type.includes(kw));
  }

  function isClosedToday(place) {
    const today = getToday();
    return isClosedDay(place.closedon, today);
  }

  function isOpenNow(place) {
    const now = currentTime();
    const openTime = Number(place.open) || 0;
    const closeTime = Number(place.closes) || 0;

    // 24h places or places where open==closes==0 → always open
    if (openTime === closeTime) return true;

    // Overnight hours (closes < open, e.g., 18:00 - 2:00)
    if (closeTime < openTime) {
      return now >= openTime || now < closeTime;
    }

    return now >= openTime && now < closeTime;
  }

  // ── Unified check (matches isCurrentlyOpen in Swift) ──
  function isCurrentlyOpen(place) {
    if (isOutdoorPOI(place)) return false;
    if (isClosedToday(place)) return false;
    return isOpenNow(place);
  }

  // ── Formatted status for display ──
  function openStatusHTML(place) {
    // Permanently closed
    if ((place.closedon || '').toLowerCase().includes('permanently closed')) {
      return '<span class="place-status status-closed" title="Permanently Closed">Permanently Closed</span>';
    }

    // Outdoor POI — no hours
    if (isOutdoorPOI(place)) {
      return '<span class="place-status status-outdoor">📍 Outdoor</span>';
    }

    // Closed today
    if (isClosedToday(place)) {
      return '<span class="place-status status-closed">Closed Today</span>';
    }

    const now = currentTime();
    const openTime = Number(place.open) || 0;
    const closeTime = Number(place.closes) || 0;

    if (isOpenNow(place)) {
      // Show closing time
      const closeStr = formatHour(closeTime);
      return '<span class="place-status status-open">🟢 Open · until ' + closeStr + '</span>';
    } else {
      // Show when it opens
      const openStr = formatHour(openTime);
      return '<span class="place-status status-closed">Opens ' + openStr + '</span>';
    }
  }

  function formatHour(h) {
    if (h === 0 || h === 24) return '12:00 AM';
    if (h === 12) return '12:00 PM';
    if (h > 24) h -= 24; // next-day times
    const hour = Math.floor(h);
    const min = Math.round((h - hour) * 60);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h12 = hour % 12 || 12;
    if (min === 0) return h12 + ':00 ' + ampm;
    return h12 + ':' + min.toString().padStart(2, '0') + ' ' + ampm;
  }

  // ── Public API ──
  window.OpenStatus = {
    isCurrentlyOpen,
    isOpenNow,
    isClosedToday,
    isOutdoorPOI,
    computeClosedDays,
    openStatusHTML,
    formatHour,
    DAY_NAMES
  };

  // Inject CSS once
  if (!document.getElementById('openstatus-css')) {
    const style = document.createElement('style');
    style.id = 'openstatus-css';
    style.textContent = `
      .place-status { font-size: 0.75rem; font-weight: 600; display: inline-block; margin-bottom: 0.4rem; }
      .place-status.status-open { color: #15803d; }
      .place-status.status-closed { color: #dc2626; }
      .place-status.status-outdoor { color: #1E6F9F; }
    `;
    document.head.appendChild(style);
  }

})();
