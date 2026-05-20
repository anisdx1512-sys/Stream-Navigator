/**
 * Channel Number OSD
 * Traditional TV-style channel dialer:
 *  - Number keys accumulate digits (e.g. 1 → 12 → 123)
 *  - Shows the channel at that number in real time
 *  - Auto-tunes after AUTO_TUNE_MS of inactivity, or immediately on Enter
 *  - Works from any screen (main browser or player)
 */
window.ChannelOSD = (function () {
  const AUTO_TUNE_MS = 2000;  // ms before auto-tune fires
  const MAX_DIGITS   = 4;     // max channel number length

  let digits      = '';       // accumulated digit string
  let autoTimer   = null;
  let fillTimer   = null;
  let onTuneCb    = null;     // function(channelIndex) called when tuning
  let channels    = [];       // full channel list (set by setChannels)
  let visible     = false;

  // DOM refs (resolved lazily)
  const el       = () => document.getElementById('channel-osd');
  const numEl    = () => document.getElementById('osd-number');
  const nameEl   = () => document.getElementById('osd-channel-name');
  const catEl    = () => document.getElementById('osd-category');
  const logoEl   = () => document.getElementById('osd-logo');

  // ── Public ───────────────────────────────────────────────────────────────

  function setChannels(list) {
    channels = list || [];
  }

  function setOnTune(cb) {
    onTuneCb = cb;
  }

  /** Called by the key handler when a digit key is pressed. */
  function pushDigit(d) {
    // Don't accumulate beyond max digits
    if (digits.length >= MAX_DIGITS) digits = '';
    digits += d;
    _show();
    _resetAutoTimer();
  }

  /** Called when Enter is pressed while the OSD is visible. */
  function confirm() {
    if (!visible) return false;
    _cancelTimers();
    _tune();
    return true;
  }

  /** Dismiss without tuning (e.g. Escape). */
  function dismiss() {
    if (!visible) return false;
    _cancelTimers();
    _hide();
    digits = '';
    return true;
  }

  function isVisible() { return visible; }

  // ── Internal ─────────────────────────────────────────────────────────────

  function _show() {
    const osd = el();
    // Re-trigger the slide-in animation on each new digit
    osd.classList.remove('hidden');
    osd.style.animation = 'none';
    // Force reflow
    void osd.offsetWidth;
    osd.style.animation = '';
    visible = true;

    const num = parseInt(digits, 10);
    numEl().textContent = digits;

    // 1-based: channel #1 is index 0
    const ch = channels[num - 1] || null;

    if (ch) {
      nameEl().textContent = ch.name;
      catEl().textContent  = ch.group || '';
      if (ch.logo) {
        logoEl().src = ch.logo;
        logoEl().style.display = '';
      } else {
        logoEl().style.display = 'none';
      }
    } else {
      nameEl().textContent = num > channels.length && channels.length > 0
        ? 'No such channel'
        : '---';
      catEl().textContent  = '';
      logoEl().style.display = 'none';
    }

    _startFillBar();
  }

  function _hide() {
    el().classList.add('hidden');
    visible = false;
    // Remove timer bar if present
    const bar = el().querySelector('.osd-timer-bar');
    if (bar) bar.remove();
  }

  function _resetAutoTimer() {
    _cancelTimers();
    // Restart fill bar
    _startFillBar();
    autoTimer = setTimeout(() => {
      _tune();
    }, AUTO_TUNE_MS);
  }

  function _cancelTimers() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    if (fillTimer) { clearTimeout(fillTimer); fillTimer = null; }
  }

  function _tune() {
    const num = parseInt(digits, 10);
    const idx = num - 1; // convert 1-based to 0-based
    _hide();
    digits = '';
    if (!isNaN(idx) && idx >= 0 && idx < channels.length && onTuneCb) {
      onTuneCb(idx);
    }
  }

  function _startFillBar() {
    // Remove any existing bar first
    const existing = el().querySelector('.osd-timer-bar');
    if (existing) existing.remove();

    // Build the bar
    const bar = document.createElement('div');
    bar.className = 'osd-timer-bar';
    const fill = document.createElement('div');
    fill.className = 'osd-timer-fill';
    bar.appendChild(fill);
    el().appendChild(bar);

    // Animate: start at 100%, shrink to 0% over AUTO_TUNE_MS
    fill.style.transition = 'none';
    fill.style.width = '100%';
    // Force reflow before starting transition
    void fill.offsetWidth;
    fill.style.transition = `width ${AUTO_TUNE_MS}ms linear`;
    fill.style.width = '0%';
  }

  // ── Key handling — registered in navigation.js interceptor chain ──────────

  /**
   * Returns true if the event was handled (consumed) by the OSD.
   * Called from Nav.setKeyInterceptor before nav/player handle it.
   */
  function handleKey(e) {
    // Ignore key events when a text input or textarea is active
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return false;

    // Digit keys: 0-9
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      pushDigit(e.key);
      return true;
    }

    // Enter while OSD is visible → tune now
    if (e.key === 'Enter' && visible) {
      e.preventDefault();
      return confirm();
    }

    // Escape / Backspace while OSD visible → dismiss
    if ((e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack') && visible) {
      e.preventDefault();
      return dismiss();
    }

    return false;
  }

  return { setChannels, setOnTune, pushDigit, confirm, dismiss, isVisible, handleKey };
})();
