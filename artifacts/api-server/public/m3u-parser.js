/**
 * M3U Parser — extracts channels from M3U/M3U8 playlist content
 * Returns array of: { name, logo, group, url, id }
 */
window.M3UParser = {
  parse(content) {
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    const channels = [];

    if (!lines[0] || !lines[0].startsWith('#EXTM3U')) {
      console.warn('[M3UParser] File does not start with #EXTM3U');
    }

    let pending = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXTINF:')) {
        pending = this._parseExtInf(line);
      } else if (line.startsWith('#')) {
        // skip other directives
        continue;
      } else if (line.startsWith('http') || line.startsWith('rtmp') || line.startsWith('rtsp')) {
        if (pending) {
          pending.url = line;
          pending.id = `ch_${channels.length}`;
          channels.push(pending);
          pending = null;
        }
      }
    }

    return channels;
  },

  _parseExtInf(line) {
    // #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." group-title="...",Channel Name
    const channel = {
      name: 'Unknown Channel',
      logo: '',
      group: 'Uncategorized',
      url: '',
      id: '',
    };

    // Extract the display name (after the last comma)
    const commaIdx = line.lastIndexOf(',');
    if (commaIdx !== -1) {
      channel.name = line.substring(commaIdx + 1).trim() || 'Unknown Channel';
    }

    // Extract attributes
    const attrStr = commaIdx !== -1 ? line.substring(0, commaIdx) : line;

    channel.name    = this._attr(attrStr, 'tvg-name')    || channel.name;
    channel.logo    = this._attr(attrStr, 'tvg-logo')    || '';
    channel.group   = this._attr(attrStr, 'group-title') || 'Uncategorized';

    // Clean up group
    channel.group = channel.group.trim() || 'Uncategorized';

    return channel;
  },

  _attr(str, name) {
    // Match: name="value" or name='value'
    const re = new RegExp(name + '=["\']([^"\']*)["\']', 'i');
    const m = str.match(re);
    return m ? m[1].trim() : '';
  },

  getCategories(channels) {
    const seen = new Set();
    const cats = ['All'];
    for (const ch of channels) {
      if (!seen.has(ch.group)) {
        seen.add(ch.group);
        cats.push(ch.group);
      }
    }
    return cats;
  },

  filterByCategory(channels, category) {
    if (!category || category === 'All') return channels;
    return channels.filter(ch => ch.group === category);
  },

  filterBySearch(channels, query) {
    if (!query) return channels;
    const q = query.toLowerCase();
    return channels.filter(ch => ch.name.toLowerCase().includes(q));
  },
};
