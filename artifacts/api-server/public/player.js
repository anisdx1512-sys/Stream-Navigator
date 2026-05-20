/**
 * Player — manages HLS.js / native video playback with retry logic
 */
window.Player = (function () {
  const VIDEO_ID = 'video-player';
  const MAX_RETRIES = 3;
  const OVERLAY_TIMEOUT_MS = 4000;

  let hls = null;
  let currentUrl = '';
  let retryCount = 0;
  let retryTimer = null;
  let overlayTimer = null;
  let overlayVisible = false;
  let onErrorCb = null;
  let onBackCb = null;

  const video   = () => document.getElementById(VIDEO_ID);
  const overlay = () => document.getElementById('player-overlay');
  const spinner = () => document.getElementById('buffering-spinner');
  const errBox  = () => document.getElementById('player-error');
  const errMsg  = () => document.getElementById('player-error-msg');
  const muteBtn = () => document.getElementById('btn-toggle-mute');

  // ── Overlay ────────────────────────────────────────────────────────────────

  function showOverlay() {
    overlay().classList.remove('hidden');
    overlayVisible = true;
    resetOverlayTimer();
    // Update time
    updateTime();
  }

  function hideOverlay() {
    overlay().classList.add('hidden');
    overlayVisible = false;
    if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
  }

  function toggleOverlay() {
    if (overlayVisible) hideOverlay();
    else showOverlay();
  }

  function resetOverlayTimer() {
    if (overlayTimer) clearTimeout(overlayTimer);
    overlayTimer = setTimeout(hideOverlay, OVERLAY_TIMEOUT_MS);
  }

  function updateTime() {
    const el = document.getElementById('overlay-time');
    if (el) {
      el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  function load(url, channel) {
    currentUrl = url;
    retryCount = 0;
    hideError();
    _doLoad(url, channel);
  }

  function _doLoad(url, channel) {
    const v = video();
    spinner().classList.remove('hidden');

    // Tear down previous HLS instance
    if (hls) {
      hls.destroy();
      hls = null;
    }
    v.src = '';

    // Update overlay info
    const nameEl = document.getElementById('overlay-channel-name');
    const logoEl = document.getElementById('overlay-logo');
    if (nameEl) nameEl.textContent = channel ? channel.name : '';
    if (logoEl) {
      if (channel && channel.logo) {
        logoEl.src = channel.logo;
        logoEl.style.display = '';
      } else {
        logoEl.style.display = 'none';
      }
    }
    showOverlay();

    const isHLS = url.includes('.m3u8') || url.includes('/hls') || url.includes('type=m3u8');

    if (isHLS && typeof Hls !== 'undefined' && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30,
      });
      hls.loadSource(url);
      hls.attachMedia(v);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        v.play().catch(() => {});
      });
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        v.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              _handleFatalError('Network error: cannot reach stream');
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              _handleFatalError('Stream error');
          }
        }
      });
    } else if (v.canPlayType('application/vnd.apple.mpegurl') || !isHLS) {
      // Native HLS (Safari / WebOS) or direct MP4/TS
      v.src = url;
      v.play().catch(() => _handleFatalError('Cannot play this stream'));
    } else {
      _handleFatalError('HLS not supported in this browser');
    }

    v.onerror = () => _handleFatalError('Video error: ' + (v.error ? v.error.message : 'unknown'));
  }

  function _handleFatalError(msg) {
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      const delay = retryCount * 2000;
      console.log(`[Player] Retry ${retryCount}/${MAX_RETRIES} in ${delay}ms`);
      showError(`Retrying... (${retryCount}/${MAX_RETRIES})`);
      retryTimer = setTimeout(() => _doLoad(currentUrl, null), delay);
    } else {
      showError(msg || 'Cannot play this channel');
      if (onErrorCb) onErrorCb(msg);
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────

  function init({ onError, onBack } = {}) {
    onErrorCb = onError || null;
    onBackCb  = onBack  || null;

    const v = video();

    v.addEventListener('waiting', () => spinner().classList.remove('hidden'));
    v.addEventListener('playing', () => {
      spinner().classList.add('hidden');
      hideError();
    });
    v.addEventListener('canplay', () => spinner().classList.add('hidden'));

    // Keep time up to date
    setInterval(updateTime, 30000);

    // Controls
    document.getElementById('btn-back-from-player').addEventListener('click', () => {
      if (onBackCb) onBackCb();
    });
    document.getElementById('btn-back-from-error').addEventListener('click', () => {
      if (onBackCb) onBackCb();
    });
    document.getElementById('btn-retry-stream').addEventListener('click', () => {
      hideError();
      load(currentUrl, null);
    });
    document.getElementById('btn-toggle-mute').addEventListener('click', () => {
      v.muted = !v.muted;
      _updateMuteIcon();
      resetOverlayTimer();
    });
    document.getElementById('btn-prev-channel').addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('player:prevChannel'));
      resetOverlayTimer();
    });
    document.getElementById('btn-next-channel').addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('player:nextChannel'));
      resetOverlayTimer();
    });
  }

  function _updateMuteIcon() {
    const v = video();
    const icon = document.getElementById('icon-volume');
    if (!icon) return;
    if (v.muted) {
      icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`;
    } else {
      icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>`;
    }
  }

  // ── Error UI ──────────────────────────────────────────────────────────────

  function showError(msg) {
    spinner().classList.add('hidden');
    errMsg().textContent = msg || 'Cannot play this channel';
    errBox().classList.remove('hidden');
  }

  function hideError() {
    errBox().classList.add('hidden');
  }

  // ── Key interceptor for player screen ─────────────────────────────────────

  function keyInterceptor(e) {
    const screen = document.getElementById('screen-player');
    if (!screen || !screen.classList.contains('active')) return false;

    if (e.key === 'Enter') {
      // Enter while overlay visible activates focused control
      if (overlayVisible) return false; // let Nav handle it
      showOverlay();
      resetOverlayTimer();
      return true;
    }

    const navKeys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Up','Down','Left','Right'];
    if (navKeys.includes(e.key)) {
      if (!overlayVisible) {
        // First arrow press shows overlay, don't navigate yet
        showOverlay();
        resetOverlayTimer();
        e.preventDefault();
        return true;
      }
      // Overlay already visible — let Nav navigate the controls
      resetOverlayTimer();
      return false;
    }

    return false;
  }

  // ── Stop ──────────────────────────────────────────────────────────────────

  function stop() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
    const v = video();
    if (hls) { hls.destroy(); hls = null; }
    v.pause();
    v.src = '';
    overlayVisible = false;
    overlay().classList.add('hidden');
    spinner().classList.add('hidden');
    hideError();
    retryCount = 0;
  }

  function setEPG(programName, start, end) {
    const epgEl = document.getElementById('overlay-epg');
    if (!epgEl) return;
    if (!programName) { epgEl.classList.add('hidden'); return; }
    epgEl.classList.remove('hidden');
    document.getElementById('epg-program-name').textContent = programName;

    const now = Date.now();
    const total = end - start;
    const elapsed = now - start;
    const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
    document.getElementById('epg-progress-fill').style.width = pct + '%';

    const fmt = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById('epg-time-range').textContent = `${fmt(start)} – ${fmt(end)}`;
  }

  return { init, load, stop, showOverlay, hideOverlay, toggleOverlay, setEPG, keyInterceptor };
})();
