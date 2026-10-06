// Turns the song's colours into a bright, vibrant palette (CSS variables).
// Order of preference:  album-art colours  ->  mood of the lyrics  ->  a hue unique to the song
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, s, l];
}

// every song gets its own stable hue (last-resort fallback)
function vibeHue(str) {
  let a = 7;
  for (const ch of str) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
  return (a * 137.508) % 360;
}

function paintTheme(h, h2) {
  const k = Math.round(h) + ',' + Math.round(h2);
  if (paintTheme.k === k) return;
  paintTheme.k = k;
  setTheme.hue = h; setTheme.hue2 = h2;                  // the glow reads these
  const n = x => Math.round(((x % 360) + 360) % 360);
  const st = document.documentElement.style;
  st.setProperty('--g1', `hsl(${n(h)} 100% 58%)`);       // glow / accent colours
  st.setProperty('--g2', `hsl(${n(h2)} 100% 62%)`);
  st.setProperty('--g3', `hsl(${n(h - 22)} 100% 60%)`);
  st.setProperty('--t',  `hsl(${n(h)} 80% 78%)`);        // lyric colour
  st.setProperty('--hl', `hsl(${n(h)} 90% 46%)`);        // highlighted-word box
}

function setTheme(c) {                                   // plain rgb -> theme (used for the start-up colour)
  const [h] = rgbToHsl(c[0], c[1], c[2]);
  paintTheme(h, h + 30);
}

const theme = { last: null, key: '', mood: null };

function resolveTheme() {
  const m = theme.last;
  if (!m) return;
  let h = theme.mood != null ? theme.mood : vibeHue(theme.key);
  let h2 = h + 35;
  if (m.color) {
    const [ch, cs] = rgbToHsl(m.color[0], m.color[1], m.color[2]);
    if (cs >= 0.2) {                                     // vivid cover: use its real colours
      h = ch; h2 = ch + 30;
      if (m.color2) { const [c2h, c2s] = rgbToHsl(m.color2[0], m.color2[1], m.color2[2]); if (c2s >= 0.2) h2 = c2h; }
    }
  }
  paintTheme(h, h2);
}

// call with every media message
function applyMediaTheme(m) {
  const key = `${m.title || ''}|${m.artist || ''}`;
  if (key !== theme.key) { theme.key = key; theme.mood = null; }   // new song: forget the old mood
  theme.last = m;
  resolveTheme();
}

// call when the lyrics are known: main.js sends the mood hue worked out from the words
function setMoodHue(h) { theme.mood = h; resolveTheme(); }

setTheme([255, 170, 60]);
