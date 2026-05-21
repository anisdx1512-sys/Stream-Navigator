/**
 * PiP — Picture-in-Picture mode.
 *
 * Shrinks the player to a floating 300×169 corner overlay so the user can
 * browse channels while the stream keeps playing.
 *
 * Key binding: P (in player OR main screen)
 *   player → enter PiP (switches to main screen)
 *   main   → exit  PiP (returns to fullscreen player)
 *
 * Clicking the mini-player also expands it back to full screen.
 */
window.PiP = (function () {
  let active = false;

  const playerEl       = () => document.getElementById('screen-player');
  const captionNameEl  = () => document.getElementById('pip-channel-name');

  // ── Public API ──────────────────────────────────────────────────────────────

  function isActive() { return active; }

  function enter(channelName) {
    if (active) return;
    active = true;
    playerEl().classList.add('pip-active');
    if (captionNameEl()) captionNameEl().textContent = channelName || '';
    document.dispatchEvent(new CustomEvent('pip:enter'));
  }

  /**
   * @param {boolean} navigate — true = dispatch pip:exit so app.js can
   *   call showScreen('player'). false = just remove the CSS class (caller
   *   is already handling navigation).
   */
  function exit(navigate) {
    if (!active) return;
    active = false;
    playerEl().classList.remove('pip-active');
    if (navigate) document.dispatchEvent(new CustomEvent('pip:exit'));
  }

  // ── Key interceptor ─────────────────────────────────────────────────────────

  function keyInterceptor(e) {
    if (e.key !== 'p' && e.key !== 'P') return false;

    const playerScreen = document.getElementById('screen-player');
    const mainScreen   = document.getElementById('screen-main');

    // Fullscreen player → enter PiP
    if (!active && playerScreen?.classList.contains('active')) {
      const name = document.getElementById('overlay-channel-name')?.textContent || '';
      enter(name);
      return true;
    }

    // Main screen with PiP active → expand back to fullscreen
    if (active && mainScreen?.classList.contains('active')) {
      exit(true);
      return true;
    }

    return false;
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  function init() {
    Nav.addKeyInterceptor(keyInterceptor);

    // Click anywhere on the mini-player to expand
    playerEl()?.addEventListener('click', () => {
      if (active) exit(true);
    });

    // Expand button inside the caption bar
    document.getElementById('btn-pip-expand')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (active) exit(true);
    });
  }

  return { init, enter, exit, isActive };
})();
