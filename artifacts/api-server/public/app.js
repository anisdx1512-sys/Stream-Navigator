/**
 * IPTV Player — Main App Logic
 * Manages screens, playlists, channel browsing, and ties all modules together.
 */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────

  const state = {
    playlists: [],          // [{name, url, channels}]
    currentPlaylistIdx: 0,
    channels: [],           // All channels from current playlist
    filteredChannels: [],   // After category + search
    categories: [],
    selectedCategory: 'All',
    searchQuery: '',
    currentChannelIdx: -1,  // Index in filteredChannels for prev/next
    lastWatchedUrl: null,
    recentlyWatched: [],    // [{name, url, logo, group, watchedAt}]
    favourites: new Set(),  // Set of channel URLs
    epgUrl: '',
    epgData: {},            // { channelId: [{title, start, end}] }
  };

  const LS_KEY = 'iptv_playlists_v2';
  const LS_EPG = 'iptv_epg_url';
  const LS_LAST = 'iptv_last_channel';
  const LS_PLAYLIST_IDX = 'iptv_playlist_idx';
  const LS_RECENT = 'iptv_recently_watched';
  const LS_FAVS  = 'iptv_favourites';
  const MAX_RECENT = 10;
  const FAV_CATEGORY = '⭐ Favourites';

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    loadFromStorage();
    Player.init({
      onError: () => Nav.focusFirst(document.getElementById('screen-player')),
      onBack: () => showScreen('main'),
    });
    Nav.setKeyInterceptor(Player.keyInterceptor);
    Nav.addKeyInterceptor(ChannelOSD.handleKey);
    SleepTimer.init();
    PiP.init();
    PinLock.init();

    document.addEventListener('sleeptimer:set', (e) => {
      const m = e.detail.minutes;
      showToast(`Sleep timer set — stops in ${m >= 60 ? (m / 60) + ' hr' : m + ' min'}`);
    });
    document.addEventListener('sleeptimer:expired', () => {
      if (PiP.isActive()) PiP.exit(false);
      Player.stop();
      showScreen('main');
      showToast('Sleep timer: playback stopped');
    });

    document.addEventListener('pip:enter', () => {
      showScreen('main');
      showToast('Picture-in-Picture — press P to return');
    });
    document.addEventListener('pip:exit', () => {
      showScreen('player');
    });

    ChannelOSD.setOnTune((idx) => {
      // Always tune against the full channel list (not filtered)
      if (idx >= 0 && idx < state.channels.length) {
        // Find the matching channel in filteredChannels, or play directly
        const ch = state.channels[idx];
        const filteredIdx = state.filteredChannels.findIndex(c => c.url === ch.url);
        if (filteredIdx >= 0) {
          playChannel(filteredIdx);
        } else {
          // Channel is filtered out — reset filters and play
          state.selectedCategory = 'All';
          state.searchQuery = '';
          document.getElementById('search-input').value = '';
          applyFilters();
          const newIdx = state.filteredChannels.findIndex(c => c.url === ch.url);
          if (newIdx >= 0) playChannel(newIdx);
        }
      }
    });

    bindSetupScreen();
    bindMainScreen();
    bindSettingsScreen();
    bindPlayerEvents();
    bindBackEvent();

    // If we have playlists, go straight to main
    if (state.playlists.length > 0) {
      loadPlaylist(state.currentPlaylistIdx);
      showScreen('main');
    } else {
      showScreen('setup');
    }

    document.getElementById('epg-url-input').value = state.epgUrl || '';
  }

  // ── Storage ────────────────────────────────────────────────────────────────

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      state.playlists = raw ? JSON.parse(raw) : [];
    } catch { state.playlists = []; }
    try {
      const rawR = localStorage.getItem(LS_RECENT);
      state.recentlyWatched = rawR ? JSON.parse(rawR) : [];
    } catch { state.recentlyWatched = []; }
    try {
      const rawF = localStorage.getItem(LS_FAVS);
      state.favourites = new Set(rawF ? JSON.parse(rawF) : []);
    } catch { state.favourites = new Set(); }
    state.epgUrl = localStorage.getItem(LS_EPG) || '';
    state.lastWatchedUrl = localStorage.getItem(LS_LAST) || null;
    state.currentPlaylistIdx = parseInt(localStorage.getItem(LS_PLAYLIST_IDX) || '0', 10) || 0;
    if (state.currentPlaylistIdx >= state.playlists.length) state.currentPlaylistIdx = 0;
  }

  function savePlaylistsToStorage() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state.playlists));
    } catch {}
  }

  // ── Favourites helpers ────────────────────────────────────────────────────

  function isFav(url) { return state.favourites.has(url); }

  function saveFavourites() {
    try {
      localStorage.setItem(LS_FAVS, JSON.stringify([...state.favourites]));
    } catch {}
  }

  function toggleFavourite(url) {
    if (state.favourites.has(url)) {
      state.favourites.delete(url);
      showToast('Removed from Favourites');
    } else {
      state.favourites.add(url);
      showToast('Added to Favourites ⭐');
    }
    saveFavourites();
    // Refresh star state on all visible cards without full re-render
    document.querySelectorAll('.channel-card[data-url], .recent-card[data-url]').forEach(card => {
      if (card.dataset.url === url) _updateStarBtn(card, isFav(url));
    });
    // If Favourites category is active, re-filter so removed items disappear
    if (state.selectedCategory === FAV_CATEGORY) applyFilters();
    // Re-render categories to update count
    renderCategories();
  }

  function _updateStarBtn(card, faved) {
    const btn = card.querySelector('.star-btn');
    if (!btn) return;
    btn.classList.toggle('starred', faved);
    btn.title = faved ? 'Remove from Favourites' : 'Add to Favourites';
    btn.innerHTML = faved ? _starIconFilled() : _starIconEmpty();
  }

  function _starIconEmpty() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>`;
  }
  function _starIconFilled() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="#f5c518" stroke="#f5c518" stroke-width="1.5">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>`;
  }

  function _makeStarBtn(url) {
    const btn = document.createElement('button');
    btn.className = 'star-btn' + (isFav(url) ? ' starred' : '');
    btn.title = isFav(url) ? 'Remove from Favourites' : 'Add to Favourites';
    btn.innerHTML = isFav(url) ? _starIconFilled() : _starIconEmpty();
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavourite(url);
    });
    return btn;
  }

  // ── Lock helpers ──────────────────────────────────────────────────────────

  function _lockIconEmpty() {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="11" width="18" height="11" rx="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>`;
  }
  function _lockIconFilled() {
    return `<svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
      <rect x="3" y="11" width="18" height="11" rx="2" fill="currentColor"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" stroke-width="2.5"/>
    </svg>`;
  }

  function _makeLockBtn(url) {
    const btn = document.createElement('button');
    const locked = PinLock.isLocked(url);
    btn.className = 'lock-btn' + (locked ? ' locked' : '');
    btn.title = locked ? 'Unlock channel (PIN required)' : 'Lock channel';
    btn.innerHTML = locked ? _lockIconFilled() : _lockIconEmpty();
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!PinLock.hasPin()) {
        showToast('Set a PIN first in Settings → Parental Controls');
        return;
      }
      PinLock.toggleLock(url, (isNowLocked) => {
        _syncLockBtns(url, isNowLocked);
        showToast(isNowLocked ? '🔒 Channel locked' : '🔓 Channel unlocked');
      }, null);
    });
    return btn;
  }

  function _syncLockBtns(url, isLocked) {
    document.querySelectorAll(`[data-url]`).forEach(card => {
      if (card.dataset.url !== url) return;
      card.classList.toggle('locked', isLocked);
      const btn = card.querySelector('.lock-btn');
      if (!btn) return;
      btn.classList.toggle('locked', isLocked);
      btn.title = isLocked ? 'Unlock channel (PIN required)' : 'Lock channel';
      btn.innerHTML = isLocked ? _lockIconFilled() : _lockIconEmpty();
    });
  }

  // ── Screen Management ─────────────────────────────────────────────────────

  function showScreen(name) {
    // Leaving the main-screen context while PiP is live — kill PiP cleanly
    if (PiP.isActive() && name !== 'main') PiP.exit(false);

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById('screen-' + name);
    if (screen) {
      screen.classList.add('active');
      setTimeout(() => Nav.focusFirst(screen), 50);
    }
    // Don't stop the player while PiP is keeping it alive in the corner
    if (name !== 'player' && !PiP.isActive()) Player.stop();
    if (name === 'main') renderRecentlyWatched();
  }

  // ── Setup Screen ──────────────────────────────────────────────────────────

  function bindSetupScreen() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    document.getElementById('btn-load-playlist').addEventListener('click', handleLoadPlaylist);
    document.getElementById('btn-skip-setup').addEventListener('click', () => {
      if (state.playlists.length > 0) {
        loadPlaylist(state.currentPlaylistIdx);
        showScreen('main');
      } else {
        showSetupError('No saved playlists. Please add one.');
      }
    });

    // Allow Enter key on URL input to trigger load
    document.getElementById('playlist-url-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLoadPlaylist();
    });
  }

  function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.toggle('active', c.id === 'tab-content-' + tab);
    });
  }

  async function handleLoadPlaylist() {
    const urlInput  = document.getElementById('playlist-url-input');
    const nameInput = document.getElementById('playlist-name-input');
    const pasteInput = document.getElementById('playlist-paste-input');
    const pasteNameInput = document.getElementById('playlist-paste-name-input');

    const activeTab = document.querySelector('.tab-content.active');
    const isUrl = activeTab && activeTab.id === 'tab-content-url';

    hideSetupError();

    if (isUrl) {
      const url = urlInput.value.trim();
      if (!url) { showSetupError('Please enter a playlist URL.'); return; }
      const name = nameInput.value.trim() || 'Playlist ' + (state.playlists.length + 1);
      await fetchAndAddPlaylist(url, name);
    } else {
      const content = pasteInput.value.trim();
      if (!content) { showSetupError('Please paste M3U content.'); return; }
      const name = pasteNameInput.value.trim() || 'Playlist ' + (state.playlists.length + 1);
      addPlaylistFromContent(name, '', content);
    }
  }

  async function fetchAndAddPlaylist(url, name) {
    setSetupLoading(true);
    try {
      const proxyUrl = '/api/proxy/m3u?url=' + encodeURIComponent(url);
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error('Server returned ' + res.status);
      const text = await res.text();
      addPlaylistFromContent(name, url, text);
    } catch (err) {
      showSetupError('Failed to load playlist: ' + err.message);
    } finally {
      setSetupLoading(false);
    }
  }

  function addPlaylistFromContent(name, url, content) {
    const channels = M3UParser.parse(content);
    if (!channels.length) {
      showSetupError('No channels found in this playlist.');
      return;
    }
    // Check if URL already exists
    const existing = state.playlists.findIndex(p => p.url && p.url === url);
    if (existing >= 0 && url) {
      state.playlists[existing] = { name, url, channels };
    } else {
      state.playlists.push({ name, url, channels });
    }
    state.currentPlaylistIdx = state.playlists.length - 1;
    savePlaylistsToStorage();
    localStorage.setItem(LS_PLAYLIST_IDX, String(state.currentPlaylistIdx));
    loadPlaylist(state.currentPlaylistIdx);
    showScreen('main');
    showToast(`Loaded ${channels.length} channels`);
  }

  function showSetupError(msg) {
    const el = document.getElementById('setup-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function hideSetupError() {
    document.getElementById('setup-error').classList.add('hidden');
  }
  function setSetupLoading(on) {
    document.getElementById('setup-loading').classList.toggle('hidden', !on);
    document.getElementById('btn-load-playlist').disabled = on;
  }

  // ── Playlist Loading ──────────────────────────────────────────────────────

  function loadPlaylist(idx) {
    const playlist = state.playlists[idx];
    if (!playlist) return;
    state.channels = playlist.channels;
    state.categories = M3UParser.getCategories(state.channels);
    state.selectedCategory = 'All';
    state.searchQuery = '';
    state.currentPlaylistIdx = idx;
    localStorage.setItem(LS_PLAYLIST_IDX, String(idx));
    ChannelOSD.setChannels(state.channels);
    applyFilters();
    renderCategories();
    if (state.epgUrl) fetchEPG(state.epgUrl);
  }

  // ── Filters ───────────────────────────────────────────────────────────────

  function applyFilters() {
    let result;
    if (state.selectedCategory === FAV_CATEGORY) {
      result = state.channels.filter(ch => isFav(ch.url));
    } else {
      result = M3UParser.filterByCategory(state.channels, state.selectedCategory);
    }
    result = M3UParser.filterBySearch(result, state.searchQuery);
    state.filteredChannels = result;
    renderChannelGrid();
  }

  // ── Main Screen ───────────────────────────────────────────────────────────

  function bindMainScreen() {
    document.getElementById('btn-settings').addEventListener('click', () => showScreen('settings'));
    document.getElementById('btn-clear-recent').addEventListener('click', () => {
      clearRecentlyWatched();
      showToast('Recently watched cleared');
    });

    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', () => {
      state.searchQuery = searchInput.value;
      applyFilters();
    });
    searchInput.addEventListener('keydown', (e) => {
      // Escape clears search
      if (e.key === 'Escape') {
        searchInput.value = '';
        state.searchQuery = '';
        applyFilters();
      }
    });
  }

  function renderCategories() {
    const list = document.getElementById('category-list');
    list.innerHTML = '';

    // Favourites entry always first (after All)
    const allCats = [FAV_CATEGORY, ...state.categories];

    allCats.forEach((cat) => {
      let count;
      if (cat === FAV_CATEGORY) {
        count = state.channels.filter(ch => isFav(ch.url)).length;
      } else if (cat === 'All') {
        count = state.channels.length;
      } else {
        count = state.channels.filter(ch => ch.group === cat).length;
      }

      const item = document.createElement('div');
      item.className = 'category-item focusable';
      if (cat === FAV_CATEGORY) item.classList.add('fav-category');
      if (cat === state.selectedCategory) item.classList.add('active');
      item.tabIndex = 0;

      const label = cat === FAV_CATEGORY
        ? `<span class="fav-cat-label">⭐ Favourites</span>`
        : `<span>${cat}</span>`;

      item.innerHTML = `${label}<span class="category-count">${count}</span>`;
      item.addEventListener('click', () => selectCategory(cat));
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') selectCategory(cat);
      });
      list.appendChild(item);
    });
  }

  function selectCategory(cat) {
    state.selectedCategory = cat;
    document.querySelectorAll('.category-item').forEach(el => {
      el.classList.toggle('active', el.querySelector('span').textContent === cat);
    });
    applyFilters();
  }

  function renderChannelGrid() {
    const grid = document.getElementById('channel-grid');
    const noResults = document.getElementById('no-results');
    const countEl = document.getElementById('channel-count');

    grid.innerHTML = '';
    const channels = state.filteredChannels;

    countEl.textContent = channels.length + ' channels';

    if (!channels.length) {
      noResults.classList.remove('hidden');
      return;
    }
    noResults.classList.add('hidden');

    const lastUrl = state.lastWatchedUrl;

    channels.forEach((ch, idx) => {
      const card = document.createElement('div');
      card.className = 'channel-card focusable';
      card.tabIndex = 0;
      card.dataset.url = ch.url;
      if (ch.url === lastUrl) card.classList.add('last-watched');
      if (isFav(ch.url)) card.classList.add('favourited');
      if (PinLock.isLocked(ch.url)) card.classList.add('locked');

      const initials = ch.name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase() || '?';
      const logoHtml = ch.logo
        ? `<img class="channel-logo" src="${escapeHtml(ch.logo)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'channel-logo-placeholder\\'>${initials}</div>'">`
        : `<div class="channel-logo-placeholder">${initials}</div>`;

      card.innerHTML = `
        <div class="channel-logo-wrap">${logoHtml}</div>
        <div class="channel-name">${escapeHtml(ch.name)}</div>
      `;

      card.appendChild(_makeStarBtn(ch.url));
      card.appendChild(_makeLockBtn(ch.url));
      card.addEventListener('click', () => playChannel(idx));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'f' || e.key === 'F') {
          e.stopPropagation();
          toggleFavourite(ch.url);
          card.classList.toggle('favourited', isFav(ch.url));
        }
        if (e.key === 'l' || e.key === 'L') {
          e.stopPropagation();
          if (!PinLock.hasPin()) { showToast('Set a PIN first in Settings → Parental Controls'); return; }
          PinLock.toggleLock(ch.url, (isNowLocked) => {
            _syncLockBtns(ch.url, isNowLocked);
            showToast(isNowLocked ? '🔒 Channel locked' : '🔓 Channel unlocked');
          }, null);
        }
      });
      grid.appendChild(card);
    });

    // Auto-focus the last-watched card or first card
    const lastCard = grid.querySelector('.last-watched') || grid.firstElementChild;
    if (lastCard) {
      setTimeout(() => Nav.focus(lastCard), 80);
    }
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  function playChannel(filteredIdx) {
    const ch = state.filteredChannels[filteredIdx];
    if (!ch) return;

    if (PinLock.isLocked(ch.url)) {
      if (!PinLock.hasPin()) {
        showToast('Set a PIN first in Settings → Parental Controls');
        return;
      }
      PinLock.promptVerify(() => _execPlay(filteredIdx), null);
      return;
    }
    _execPlay(filteredIdx);
  }

  function _execPlay(filteredIdx) {
    const ch = state.filteredChannels[filteredIdx];
    if (!ch) return;
    state.currentChannelIdx = filteredIdx;
    state.lastWatchedUrl = ch.url;
    localStorage.setItem(LS_LAST, ch.url);

    if (PiP.isActive()) PiP.exit(false);

    addToRecentlyWatched(ch);
    showScreen('player');
    Player.load(ch.url, ch);

    const epgNow = getEPGNow(ch.name);
    if (epgNow) Player.setEPG(epgNow.title, epgNow.start, epgNow.end);
  }

  // ── Recently Watched ──────────────────────────────────────────────────────

  function addToRecentlyWatched(ch) {
    // Remove existing entry for same URL so it floats to top
    state.recentlyWatched = state.recentlyWatched.filter(r => r.url !== ch.url);
    state.recentlyWatched.unshift({
      name: ch.name,
      url: ch.url,
      logo: ch.logo || '',
      group: ch.group || '',
      watchedAt: Date.now(),
    });
    // Cap at MAX_RECENT
    if (state.recentlyWatched.length > MAX_RECENT) {
      state.recentlyWatched = state.recentlyWatched.slice(0, MAX_RECENT);
    }
    try {
      localStorage.setItem(LS_RECENT, JSON.stringify(state.recentlyWatched));
    } catch {}
  }

  function clearRecentlyWatched() {
    state.recentlyWatched = [];
    localStorage.removeItem(LS_RECENT);
    renderRecentlyWatched();
  }

  function relativeTime(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function renderRecentlyWatched() {
    const section = document.getElementById('recently-watched-section');
    const rail    = document.getElementById('recently-watched-rail');
    if (!state.recentlyWatched.length) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    rail.innerHTML = '';

    const currentUrl = state.lastWatchedUrl;

    state.recentlyWatched.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'recent-card focusable';
      card.tabIndex = 0;
      card.dataset.url = item.url;
      if (isFav(item.url)) card.classList.add('favourited');
      if (PinLock.isLocked(item.url)) card.classList.add('locked');

      const initials = item.name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase() || '?';
      const logoHtml = item.logo
        ? `<img class="recent-logo" src="${escapeHtml(item.logo)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'recent-logo-placeholder\\'>${initials}</div>'">`
        : `<div class="recent-logo-placeholder">${initials}</div>`;

      card.innerHTML = `
        <div class="recent-logo-wrap">${logoHtml}</div>
        <div class="recent-name">${escapeHtml(item.name)}</div>
        <div class="recent-time">${relativeTime(item.watchedAt)}</div>
        ${item.url === currentUrl ? '<div class="recent-playing-badge"></div>' : ''}
      `;

      card.appendChild(_makeStarBtn(item.url));
      card.appendChild(_makeLockBtn(item.url));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'f' || e.key === 'F') {
          e.stopPropagation();
          toggleFavourite(item.url);
          card.classList.toggle('favourited', isFav(item.url));
        }
        if (e.key === 'l' || e.key === 'L') {
          e.stopPropagation();
          if (!PinLock.hasPin()) { showToast('Set a PIN first in Settings → Parental Controls'); return; }
          PinLock.toggleLock(item.url, (isNowLocked) => {
            _syncLockBtns(item.url, isNowLocked);
            showToast(isNowLocked ? '🔒 Channel locked' : '🔓 Channel unlocked');
          }, null);
        }
      });

      card.addEventListener('click', () => {
        // Find this channel in the full list and play it
        const ch = state.channels.find(c => c.url === item.url);
        if (!ch) { showToast('Channel not found in current playlist'); return; }
        // Make sure it's in filteredChannels
        let filteredIdx = state.filteredChannels.findIndex(c => c.url === item.url);
        if (filteredIdx < 0) {
          state.selectedCategory = 'All';
          state.searchQuery = '';
          document.getElementById('search-input').value = '';
          applyFilters();
          filteredIdx = state.filteredChannels.findIndex(c => c.url === item.url);
        }
        if (filteredIdx >= 0) playChannel(filteredIdx);
      });

      rail.appendChild(card);
    });
  }

  function playPrevChannel() {
    let idx = state.currentChannelIdx - 1;
    if (idx < 0) idx = state.filteredChannels.length - 1;
    playChannel(idx);
  }

  function playNextChannel() {
    let idx = state.currentChannelIdx + 1;
    if (idx >= state.filteredChannels.length) idx = 0;
    playChannel(idx);
  }

  // ── Player Events ─────────────────────────────────────────────────────────

  function bindPlayerEvents() {
    document.addEventListener('player:prevChannel', playPrevChannel);
    document.addEventListener('player:nextChannel', playNextChannel);
  }

  // ── Settings Screen ───────────────────────────────────────────────────────

  function bindSettingsScreen() {
    document.getElementById('btn-back-from-settings').addEventListener('click', () => {
      showScreen('main');
    });
    document.getElementById('btn-add-playlist').addEventListener('click', () => {
      showScreen('setup');
    });
    document.getElementById('btn-save-epg').addEventListener('click', () => {
      const url = document.getElementById('epg-url-input').value.trim();
      state.epgUrl = url;
      if (url) localStorage.setItem(LS_EPG, url);
      else localStorage.removeItem(LS_EPG);
      if (url) fetchEPG(url);
      showToast('EPG URL saved');
    });

    // Parental controls
    document.getElementById('btn-set-pin').addEventListener('click', () => {
      PinLock.promptSetPin(() => {
        renderParentalStatus();
        showToast('PIN set — channels can now be locked with L');
      }, null);
    });
    document.getElementById('btn-change-pin').addEventListener('click', () => {
      PinLock.promptVerify(() => {
        PinLock.promptSetPin(() => {
          renderParentalStatus();
          showToast('PIN changed successfully');
        }, null);
      }, null);
    });
    document.getElementById('btn-remove-pin').addEventListener('click', () => {
      PinLock.promptVerify(() => {
        PinLock.removePin();
        renderParentalStatus();
        applyFilters();
        renderRecentlyWatched();
        showToast('PIN removed — all channels unlocked');
      }, null);
    });
  }

  function renderParentalStatus() {
    const el = document.getElementById('parental-status');
    if (!el) return;
    const count = PinLock.lockedCount();
    if (PinLock.hasPin()) {
      el.innerHTML = `<span class="pin-set-badge">✓ PIN set</span> — ${count} channel${count !== 1 ? 's' : ''} locked`;
    } else {
      el.innerHTML = `<span class="pin-unset-badge">No PIN set</span> — set a PIN to lock channels`;
    }
    const hasPIN = PinLock.hasPin();
    document.getElementById('btn-set-pin').classList.toggle('hidden', hasPIN);
    document.getElementById('btn-change-pin').classList.toggle('hidden', !hasPIN);
    document.getElementById('btn-remove-pin').classList.toggle('hidden', !hasPIN);
  }

  function renderSettingsPlaylists() {
    const list = document.getElementById('playlists-list');
    list.innerHTML = '';
    if (!state.playlists.length) {
      list.innerHTML = '<p style="color:var(--text-3);font-size:22px;">No playlists added yet.</p>';
      return;
    }
    state.playlists.forEach((pl, i) => {
      const item = document.createElement('div');
      item.className = 'playlist-item';
      item.innerHTML = `
        <div class="playlist-item-info">
          <div class="playlist-item-name">${escapeHtml(pl.name)} <span style="color:var(--text-3);font-size:18px;">(${pl.channels.length} channels)</span></div>
          <div class="playlist-item-url">${escapeHtml(pl.url || 'Pasted content')}</div>
        </div>
        <div class="playlist-item-actions">
          <button class="btn-sm focusable btn-load">Load</button>
          ${pl.url ? `<button class="btn-sm focusable btn-refresh">Refresh</button>` : ''}
          <button class="btn-sm focusable btn-danger btn-delete">Delete</button>
        </div>
      `;
      item.querySelector('.btn-load').addEventListener('click', () => {
        loadPlaylist(i);
        showScreen('main');
        showToast(`Loaded: ${pl.name}`);
      });
      const refreshBtn = item.querySelector('.btn-refresh');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
          showToast('Refreshing...');
          await fetchAndAddPlaylist(pl.url, pl.name);
          renderSettingsPlaylists();
        });
      }
      item.querySelector('.btn-delete').addEventListener('click', () => {
        state.playlists.splice(i, 1);
        if (state.currentPlaylistIdx >= state.playlists.length) {
          state.currentPlaylistIdx = Math.max(0, state.playlists.length - 1);
        }
        savePlaylistsToStorage();
        renderSettingsPlaylists();
        showToast('Playlist deleted');
      });
      list.appendChild(item);
    });
  }

  // Override showScreen to render settings when opening
  const _origShowScreen = showScreen;
  Object.assign(window, {});
  // Patch: re-render settings list when settings screen is shown
  const origShowScreenFn = showScreen;
  function showScreenPatched(name) {
    origShowScreenFn(name);
    if (name === 'settings') { renderSettingsPlaylists(); renderParentalStatus(); }
  }
  // Replace references
  // (We use the patched version via the back-event and explicit calls)
  document.getElementById('btn-settings').addEventListener('click', () => showScreenPatched('settings'));
  document.getElementById('btn-back-from-settings').addEventListener('click', () => showScreenPatched('main'));
  document.getElementById('btn-add-playlist').addEventListener('click', () => showScreenPatched('setup'));

  // ── Back Navigation ───────────────────────────────────────────────────────

  function bindBackEvent() {
    document.addEventListener('nav:back', () => {
      const active = document.querySelector('.screen.active');
      if (!active) return;
      const id = active.id;
      if (id === 'screen-player') { Player.stop(); showScreen('main'); }
      else if (id === 'screen-settings') showScreen('main');
      else if (id === 'screen-main' && state.playlists.length > 0) { /* stay */ }
      else showScreen('setup');
    });
  }

  // ── EPG ───────────────────────────────────────────────────────────────────

  async function fetchEPG(url) {
    try {
      const proxyUrl = '/api/proxy/epg?url=' + encodeURIComponent(url);
      const res = await fetch(proxyUrl);
      if (!res.ok) return;
      const text = await res.text();
      parseEPG(text);
    } catch {}
  }

  function parseEPG(xmlText) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'application/xml');
      state.epgData = {};
      doc.querySelectorAll('programme').forEach(prog => {
        const chan = prog.getAttribute('channel') || '';
        const title = prog.querySelector('title')?.textContent || '';
        const start = parseEPGDate(prog.getAttribute('start'));
        const end   = parseEPGDate(prog.getAttribute('stop'));
        if (!state.epgData[chan]) state.epgData[chan] = [];
        state.epgData[chan].push({ title, start, end });
      });
    } catch {}
  }

  function parseEPGDate(s) {
    if (!s) return 0;
    // Format: 20240101120000 +0000
    const m = s.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (!m) return 0;
    return Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]);
  }

  function getEPGNow(channelName) {
    const now = Date.now();
    // Find by channel name (loose match)
    for (const [id, progs] of Object.entries(state.epgData)) {
      if (!id.toLowerCase().includes(channelName.toLowerCase().substring(0,5))) continue;
      const prog = progs.find(p => p.start <= now && p.end > now);
      if (prog) return prog;
    }
    return null;
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
  }

  // ── Utils ─────────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
