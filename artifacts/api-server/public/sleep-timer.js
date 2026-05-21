/**
 * SleepTimer — countdown that stops playback after a user-chosen interval.
 *
 * Key binding: S (in player screen) opens/closes the menu.
 * The indicator pill is always visible over the video while a timer is active.
 */
window.SleepTimer = (function () {
  const OPTIONS_MINS = [15, 30, 60, 90];

  let endsAt = 0;        // epoch ms when the timer fires
  let tickHandle = null;
  let menuVisible = false;

  // ── DOM helpers ─────────────────────────────────────────────────────────────
  const indicatorEl = () => document.getElementById('sleep-timer-indicator');
  const menuEl      = () => document.getElementById('sleep-timer-menu');
  const menuBtns    = () => Array.from(document.querySelectorAll('.sleep-opt-btn'));

  // ── State ────────────────────────────────────────────────────────────────────
  function isActive() {
    return endsAt > 0 && Date.now() < endsAt;
  }

  // ── Timer control ────────────────────────────────────────────────────────────
  function set(minutes) {
    _stopTick();
    if (!minutes) { cancel(); return; }
    endsAt = Date.now() + minutes * 60 * 1000;
    _startTick();
    _updateIndicator();
    _syncMenuActiveState();
    hideMenu();
    document.dispatchEvent(new CustomEvent('sleeptimer:set', { detail: { minutes } }));
  }

  function cancel() {
    _stopTick();
    endsAt = 0;
    _updateIndicator();
    _syncMenuActiveState();
  }

  function _startTick() {
    tickHandle = setInterval(() => {
      if (!isActive()) {
        _stopTick();
        endsAt = 0;
        _updateIndicator();
        _syncMenuActiveState();
        document.dispatchEvent(new CustomEvent('sleeptimer:expired'));
        return;
      }
      _updateIndicator();
    }, 1000);
  }

  function _stopTick() {
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
  }

  // ── Indicator pill ───────────────────────────────────────────────────────────
  function _updateIndicator() {
    const el = indicatorEl();
    if (!el) return;
    if (!isActive()) {
      el.classList.add('hidden');
      return;
    }
    const secs = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    const m    = Math.floor(secs / 60);
    const s    = secs % 60;
    el.textContent = `💤 ${m}:${String(s).padStart(2, '0')}`;
    el.classList.remove('hidden');
  }

  // ── Menu ─────────────────────────────────────────────────────────────────────
  function showMenu() {
    const menu = menuEl();
    if (!menu) return;
    menuVisible = true;
    menu.classList.remove('hidden');
    _syncMenuActiveState();
    // Focus the currently active option or the first button
    const btns = menuBtns();
    const active = btns.find(b => b.classList.contains('sleep-active')) || btns[0];
    if (active) setTimeout(() => active.focus(), 30);
  }

  function hideMenu() {
    menuEl()?.classList.add('hidden');
    menuVisible = false;
  }

  function _syncMenuActiveState() {
    menuBtns().forEach(btn => {
      const mins = parseInt(btn.dataset.mins, 10);
      const isCurrentOff = (mins === 0 && !isActive());
      const isCurrentOn  = (mins > 0 && isActive() && Math.abs((endsAt - Date.now()) - mins * 60000) < 5000);
      btn.classList.toggle('sleep-active', isCurrentOff || isCurrentOn);
    });
  }

  // ── Key interceptor ──────────────────────────────────────────────────────────
  function keyInterceptor(e) {
    const playerScreen = document.getElementById('screen-player');
    if (!playerScreen?.classList.contains('active')) return false;

    // S toggles the menu
    if (e.key === 's' || e.key === 'S') {
      if (menuVisible) hideMenu();
      else showMenu();
      return true;
    }

    // While menu is open, consume Escape to close it
    if (menuVisible && e.key === 'Escape') {
      hideMenu();
      return true;
    }

    return false;
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    Nav.addKeyInterceptor(keyInterceptor);

    menuBtns().forEach(btn => {
      const mins = parseInt(btn.dataset.mins, 10);
      btn.addEventListener('click', () => set(mins));
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { set(mins); e.preventDefault(); }
        if (e.key === 'Escape') { hideMenu(); e.preventDefault(); }
      });
    });
  }

  return { init, set, cancel, isActive, showMenu, hideMenu, keyInterceptor };
})();
