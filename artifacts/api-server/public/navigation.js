/**
 * Navigation Manager — D-pad / keyboard focus management for TV UIs
 * All interactive elements must have class "focusable"
 */
window.Nav = (function () {
  let currentFocus = null;
  let enabled = true;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function getFocusables(scope) {
    const root = scope || document;
    return Array.from(root.querySelectorAll('.focusable:not([disabled]):not(.hidden)'))
      .filter(el => {
        // must be visible and not inside a hidden screen
        const screen = el.closest('.screen');
        if (screen && !screen.classList.contains('active')) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
  }

  function getRect(el) {
    return el.getBoundingClientRect();
  }

  function center(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }

  /**
   * Find the best focusable element in a given direction from `from`.
   * Uses a weighted score: primary axis distance + perpendicular penalty.
   */
  function findNearest(from, direction, candidates) {
    const fr = getRect(from);
    const fc = center(fr);

    let best = null;
    let bestScore = Infinity;

    for (const el of candidates) {
      if (el === from) continue;
      const r = getRect(el);
      const c = center(r);

      let primary = 0;   // distance along the navigation axis
      let perp = 0;      // distance perpendicular

      switch (direction) {
        case 'up':
          primary = fc.y - c.y;
          perp = Math.abs(fc.x - c.x);
          break;
        case 'down':
          primary = c.y - fc.y;
          perp = Math.abs(fc.x - c.x);
          break;
        case 'left':
          primary = fc.x - c.x;
          perp = Math.abs(fc.y - c.y);
          break;
        case 'right':
          primary = c.x - fc.x;
          perp = Math.abs(fc.y - c.y);
          break;
      }

      // Must be strictly in that direction
      if (primary <= 0) continue;

      // Score: primary distance + perpendicular penalty (3x weight)
      const score = primary + perp * 3;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return best;
  }

  /**
   * Wrap-around: if no element found in direction, wrap to the opposite edge.
   */
  function findWrap(direction, candidates) {
    if (!candidates.length) return null;
    switch (direction) {
      case 'up':    return candidates.reduce((a, b) => getRect(a).bottom > getRect(b).bottom ? a : b);
      case 'down':  return candidates.reduce((a, b) => getRect(a).top    < getRect(b).top    ? a : b);
      case 'left':  return candidates.reduce((a, b) => getRect(a).right  > getRect(b).right  ? a : b);
      case 'right': return candidates.reduce((a, b) => getRect(a).left   < getRect(b).left   ? a : b);
    }
    return null;
  }

  function scrollIntoView(el) {
    // Scroll the nearest scrollable ancestor to keep el visible
    let parent = el.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      const overflow = style.overflow + style.overflowY;
      if (/auto|scroll/.test(overflow)) {
        const r = el.getBoundingClientRect();
        const pr = parent.getBoundingClientRect();
        const margin = 60;
        if (r.bottom > pr.bottom - margin) {
          parent.scrollTop += r.bottom - pr.bottom + margin;
        } else if (r.top < pr.top + margin) {
          parent.scrollTop -= pr.top - r.top + margin;
        }
        break;
      }
      parent = parent.parentElement;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function focus(el, { scroll = true } = {}) {
    if (!el) return;
    if (currentFocus) {
      currentFocus.classList.remove('focused');
    }
    currentFocus = el;
    currentFocus.classList.add('focused');
    if (scroll) scrollIntoView(el);
    // Also call native focus for accessibility / input elements
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.focus({ preventScroll: true });
    }
  }

  function navigate(direction) {
    if (!enabled) return false;
    const candidates = getFocusables();
    if (!candidates.length) return false;

    // If nothing focused, focus first element
    if (!currentFocus || !document.contains(currentFocus)) {
      focus(candidates[0]);
      return true;
    }

    const next = findNearest(currentFocus, direction, candidates)
               || findWrap(direction, candidates);

    if (next) {
      focus(next);
      return true;
    }
    return false;
  }

  function activate(el) {
    const target = el || currentFocus;
    if (!target) return;
    target.click();
  }

  function focusFirst(scope) {
    const candidates = getFocusables(scope);
    if (candidates.length) focus(candidates[0]);
  }

  function setEnabled(val) { enabled = val; }

  // ── Key Handling ──────────────────────────────────────────────────────────

  const KEY_MAP = {
    ArrowUp:    'up',
    ArrowDown:  'down',
    ArrowLeft:  'left',
    ArrowRight: 'right',
    // WebOS remote
    Up:    'up',
    Down:  'down',
    Left:  'left',
    Right: 'right',
  };

  // Chain of key interceptors — checked in order, first truthy return wins
  const interceptors = [];
  function addKeyInterceptor(fn) { interceptors.push(fn); }
  // Legacy single-interceptor setter kept for compatibility
  function setKeyInterceptor(fn) { interceptors[0] = fn; }

  document.addEventListener('keydown', function (e) {
    for (const fn of interceptors) {
      if (fn && fn(e)) return;
    }

    const dir = KEY_MAP[e.key];
    if (dir) {
      e.preventDefault();
      navigate(dir);
      return;
    }

    if (e.key === 'Enter') {
      // If focused element is input/textarea, let it type
      if (currentFocus && (currentFocus.tagName === 'INPUT' || currentFocus.tagName === 'TEXTAREA')) {
        return;
      }
      e.preventDefault();
      activate();
    }

    if (e.key === 'Backspace' || e.key === 'Escape' || e.key === 'GoBack') {
      e.preventDefault();
      // Emit a custom "back" event for the app to handle
      document.dispatchEvent(new CustomEvent('nav:back'));
    }
  });

  // Mouse hover also syncs focus
  document.addEventListener('mouseover', function (e) {
    const el = e.target.closest('.focusable');
    if (el) focus(el, { scroll: false });
  });

  return { focus, navigate, activate, focusFirst, setEnabled, setKeyInterceptor, addKeyInterceptor, getFocusables };
})();
