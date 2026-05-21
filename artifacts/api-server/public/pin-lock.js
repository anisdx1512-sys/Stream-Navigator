/**
 * PinLock — channel lock / parental PIN.
 *
 * Modes:
 *   'verify'  – enter existing PIN (to play or unlock a channel)
 *   'set'     – enter a new 4-digit PIN (first pass)
 *   'confirm' – re-enter the new PIN to confirm
 *
 * Usage:
 *   PinLock.promptVerify(onSuccess, onCancel)
 *   PinLock.promptSetPin(onSuccess, onCancel)
 *   PinLock.toggleLock(url)          → true = now locked, false = now unlocked (may require verify first)
 *   PinLock.isLocked(url)
 *   PinLock.hasPin()
 *   PinLock.removePin()              → clears PIN and all locks
 *   PinLock.lockedCount()
 */
window.PinLock = (function () {
  const LS_PIN    = 'iptv_pin';
  const LS_LOCKED = 'iptv_locked';

  let _pin    = localStorage.getItem(LS_PIN) || '';
  let _locked = new Set(JSON.parse(localStorage.getItem(LS_LOCKED) || '[]'));

  let _entered    = '';
  let _newPinTemp = '';
  let _mode       = 'verify';
  let _successCb  = null;
  let _cancelCb   = null;

  // ── Persistence ─────────────────────────────────────────────────────────────

  function _saveLocked() {
    localStorage.setItem(LS_LOCKED, JSON.stringify([..._locked]));
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  function isLocked(url)  { return _locked.has(url); }
  function hasPin()       { return _pin.length === 4; }
  function lockedCount()  { return _locked.size; }

  function removePin() {
    _pin = '';
    localStorage.removeItem(LS_PIN);
    _locked.clear();
    _saveLocked();
  }

  /**
   * Lock a channel directly (no PIN required to add a lock).
   * To unlock, callers must verify the PIN themselves.
   */
  function lock(url) {
    _locked.add(url);
    _saveLocked();
  }

  function unlock(url) {
    _locked.delete(url);
    _saveLocked();
  }

  /**
   * Toggle lock on a channel.
   * If locking   → just lock (immediate, no PIN).
   * If unlocking → requires PIN verify; calls onSuccess with url on success.
   */
  function toggleLock(url, onSuccess, onCancel) {
    if (_locked.has(url)) {
      // Need PIN to unlock
      promptVerify(() => {
        unlock(url);
        if (onSuccess) onSuccess(false); // false = now unlocked
      }, onCancel);
    } else {
      lock(url);
      if (onSuccess) onSuccess(true); // true = now locked
    }
  }

  // ── Overlay helpers ──────────────────────────────────────────────────────────

  const overlayEl  = () => document.getElementById('pin-overlay');
  const titleEl    = () => document.getElementById('pin-title');
  const subtitleEl = () => document.getElementById('pin-subtitle');
  const errorEl    = () => document.getElementById('pin-error');
  const dot        = i  => document.getElementById('pin-dot-' + i);

  function _show() {
    overlayEl().classList.remove('hidden');
    // Focus the first numpad key
    const first = overlayEl().querySelector('.pin-key');
    if (first) setTimeout(() => first.focus(), 40);
  }

  function _hide() {
    overlayEl().classList.add('hidden');
    _entered = '';
    _newPinTemp = '';
    _updateDots();
    _clearError();
  }

  function _updateDots() {
    for (let i = 0; i < 4; i++) {
      const d = dot(i);
      if (d) d.classList.toggle('filled', i < _entered.length);
    }
  }

  function _showError(msg) {
    const el = errorEl();
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function _clearError() {
    errorEl()?.classList.add('hidden');
  }

  function _setTitle(title, subtitle) {
    if (titleEl()) titleEl().textContent = title;
    if (subtitleEl()) subtitleEl().textContent = subtitle;
  }

  // ── Digit input ──────────────────────────────────────────────────────────────

  function _addDigit(d) {
    if (_entered.length >= 4) return;
    _entered += d;
    _clearError();
    _updateDots();
    if (_entered.length === 4) _submit();
  }

  function _delDigit() {
    if (!_entered.length) return;
    _entered = _entered.slice(0, -1);
    _clearError();
    _updateDots();
  }

  function _submit() {
    if (_mode === 'verify') {
      if (_entered === _pin) {
        _hide();
        if (_successCb) _successCb();
      } else {
        _showError('Incorrect PIN — try again');
        _entered = '';
        _updateDots();
      }
    } else if (_mode === 'set') {
      if (_entered.length < 4) { _showError('Enter all 4 digits'); return; }
      _newPinTemp = _entered;
      _entered = '';
      _mode = 'confirm';
      _setTitle('Confirm PIN', 'Re-enter your new PIN');
      _updateDots();
      _clearError();
    } else if (_mode === 'confirm') {
      if (_entered === _newPinTemp) {
        _pin = _entered;
        localStorage.setItem(LS_PIN, _pin);
        _hide();
        if (_successCb) _successCb();
      } else {
        _showError('PINs do not match — start again');
        _entered = '';
        _newPinTemp = '';
        _mode = 'set';
        _setTitle('Set PIN', 'Enter a 4-digit PIN');
        _updateDots();
      }
    }
  }

  // ── Public prompt methods ────────────────────────────────────────────────────

  function promptVerify(onSuccess, onCancel) {
    _successCb = onSuccess || null;
    _cancelCb  = onCancel  || null;
    _mode      = 'verify';
    _entered   = '';
    _setTitle('🔒 Locked Channel', 'Enter PIN to watch');
    _updateDots();
    _clearError();
    _show();
  }

  function promptSetPin(onSuccess, onCancel) {
    _successCb = onSuccess || null;
    _cancelCb  = onCancel  || null;
    _mode      = 'set';
    _entered   = '';
    _newPinTemp = '';
    _setTitle('Set PIN', 'Enter a new 4-digit PIN');
    _updateDots();
    _clearError();
    _show();
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  function init() {
    // Numpad digit buttons
    overlayEl()?.querySelectorAll('.pin-key[data-digit]').forEach(btn => {
      const d = btn.dataset.digit;
      btn.addEventListener('click', () => _addDigit(d));
    });

    document.getElementById('pin-del')?.addEventListener('click', _delDigit);
    document.getElementById('pin-ok')?.addEventListener('click', _submit);
    document.getElementById('pin-cancel')?.addEventListener('click', () => {
      _hide();
      if (_cancelCb) _cancelCb();
    });

    // Keyboard shortcut: digits 0-9, Backspace, Enter while overlay is visible
    document.addEventListener('keydown', (e) => {
      if (overlayEl()?.classList.contains('hidden')) return;
      if (e.key >= '0' && e.key <= '9') { _addDigit(e.key); e.preventDefault(); }
      else if (e.key === 'Backspace')    { _delDigit();      e.preventDefault(); }
      else if (e.key === 'Enter')        { _submit();        e.preventDefault(); }
      else if (e.key === 'Escape')       {
        _hide();
        if (_cancelCb) _cancelCb();
        e.preventDefault();
      }
    });
  }

  return {
    init, isLocked, hasPin, lockedCount,
    lock, unlock, toggleLock, removePin,
    promptVerify, promptSetPin,
  };
})();
