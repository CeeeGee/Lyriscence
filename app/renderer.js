const stage = document.getElementById('stage');
const meta = document.getElementById('meta');
const hint = document.getElementById('hint');

let track = null, lines = [], idx = -2, offset = 0, current = null;
let base = { pos: 0, t: 0, playing: false };

const hash = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const plain = s => s.replace(/[^\p{L}\p{N}]/gu, '');

function parseLRC(s) {
  const out = [];
  for (const raw of s.split('\n')) {
    const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (m) out.push({ t: +m[1] * 60 + +m[2], text: m[3].trim() });
  }
  return out;
}

// YouTube cleanup: "Artist - Song (Official Video)" -> artist + song
function clean(m) {
  let title = m.title, artist = m.artist;
  title = title.replace(/\s*[\(\[][^\)\]]*(official|lyric|video|audio|visuali[sz]er|hd|4k|remaster)[^\)\]]*[\)\]]/ig, '');
  artist = artist.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  if (/chrome|msedge|firefox|brave|opera/i.test(m.app)) {
    const parts = title.split(' - ');
    if (parts.length >= 2) { artist = parts[0].trim(); title = parts.slice(1).join(' - ').trim(); }
  }
  return { title: title.trim(), artist };
}

// merge neighbouring words until we have at most 6 rows
function group(words) {
  const g = [...words];
  while (g.length > 6) {
    let best = 0, bs = Infinity;
    for (let i = 0; i < g.length - 1; i++) {
      const s = g[i].length + g[i + 1].length;
      if (s < bs) { bs = s; best = i; }
    }
    g.splice(best, 2, g[best] + ' ' + g[best + 1]);
  }
  return g;
}

// ---------- text modes ----------
//  'vertical'   : words stacked one under the other (one BIG word, small ones, maybe a highlighted box);
//                 the line rolls up through the window
//  'horizontal' : the standard look - the line as normal text, words appear left to right;
//                 the old line fades away first, then the new one is sung in
let textMode = 'vertical';
try { if (localStorage.getItem('rl-text-mode') === 'horizontal') textMode = 'horizontal'; } catch {}

// every word fades in, moving UP into place, at the moment it is sung:
// spread across the line's own duration, longer words get a longer share of the time
function reveal(units, dur, lead, instant) {
  const w = units.map(u => plain(u.textContent).length + 1);
  const total = w.reduce((a, b) => a + b, 0);
  const span = Math.max(0.35, Math.min(dur * 0.7, units.length * 0.42));
  let cum = 0;
  units.forEach((u, i) => {
    const d = lead + span * (cum / total);
    cum += w[i];
    if (instant) { u.style.opacity = 1; u.style.transform = 'none'; u.style.transition = 'none'; return; }
    u.style.transition = 'none';
    u.style.opacity = 0;
    u.style.transform = 'translateY(.55em)';
    u._d = d;
  });
  if (instant) return;
  units[0] && units[0].getBoundingClientRect();         // commit the hidden start state
  units.forEach(u => {
    u.style.transition = `opacity .5s ease-out ${u._d}s, transform .6s cubic-bezier(.2,.8,.25,1) ${u._d}s`;
    u.style.opacity = 1;
    u.style.transform = 'none';
  });
}

function layout(text, dur, instant) {
  current = { text, dur };
  const H = stage.clientHeight, W = stage.clientWidth;
  const vertical = textMode === 'vertical';
  const hadOld = !!stage.querySelector('.stack:not(.out)');
  const MS = 800;
  const D = H * 1.05;                                   // roll distance = one window height, so old and new never touch

  // 1) the old line leaves
  stage.querySelectorAll('.stack:not(.out)').forEach(old => {
    old.classList.add('out');
    if (vertical) {                                     // rolls UP and out
      old.querySelectorAll('.row').forEach(row => {
        row.style.transition = instant ? 'none' : `transform ${MS}ms cubic-bezier(.65,0,.25,1)`;
        row.style.transform = `translateY(${-D}px)`;
      });
    } else {                                            // standard: fades away
      old.style.transition = instant ? 'none' : 'opacity .3s ease-out';
      old.style.opacity = 0;
    }
    setTimeout(() => old.remove(), instant ? 0 : MS + 400);
  });

  const words = (text || '♪').split(/\s+/).filter(Boolean);
  const stack = document.createElement('div');
  stack.className = 'stack';

  if (vertical) {
    const rows = group(words);
    let big = 0;
    rows.forEach((r, i) => { if (plain(r).length > plain(rows[big]).length) big = i; });

    let hlDone = false;
    const kinds = rows.map((r, i) => {
      const len = plain(r).length;
      if (rows.length === 1 || i === big) return { t: 'big', f: 1 };
      if (!hlDone && len >= 3 && hash(r) % 2 === 0) { hlDone = true; return { t: 'hl', f: .55 }; }
      if (len <= 2) return { t: 'sm', f: .4 };
      return { t: 'md', f: .6 };
    });
    const sumF = kinds.reduce((a, k) => a + k.f, 0);
    const baseSize = Math.min(H * 0.26, (H * 0.84) / (sumF * 1.1));

    const rowEls = [], units = [];
    rows.forEach((r, i) => {
      const k = kinds[i];
      const size = Math.min(baseSize * k.f, (W * 0.9) / (Math.max(r.length, 1) * 0.62));
      const row = document.createElement('div');
      row.className = 'row';
      row.style.fontSize = size + 'px';
      const inn = document.createElement('span');
      inn.className = 'in t-' + k.t;
      inn.textContent = r;
      row.append(inn); stack.append(row);
      rowEls.push(row); units.push(inn);
      if (!instant) { row.style.transition = 'none'; row.style.transform = `translateY(${D}px)`; }
    });
    stage.append(stack);
    if (!instant) {
      stack.getBoundingClientRect();
      rowEls.forEach(row => {
        row.style.transition = `transform ${MS}ms cubic-bezier(.65,0,.25,1)`;
        row.style.transform = 'translateY(0)';
      });
    }
    reveal(units, dur, hadOld ? 0.25 : 0.05, instant);

  } else {
    // biggest font that lets the whole line fit the window (wrapped over as many lines as needed)
    const chars = words.join(' ').length;
    let size = Math.min(H * 0.2, 96);
    for (; size > 18; size -= 2) {
      const perLine = Math.max(1, Math.floor((W * 0.92) / (size * 0.56)));
      if (Math.ceil(chars / perLine) * size * 1.22 <= H * 0.8) break;
    }
    const line = document.createElement('div');
    line.className = 'hline';
    line.style.fontSize = size + 'px';
    const units = words.map((wd, i) => {
      const s = document.createElement('span');
      s.className = 'in t-h';
      s.textContent = wd;
      line.append(s);
      if (i < words.length - 1) line.append(' ');
      return s;
    });
    stack.append(line);
    stage.append(stack);
    reveal(units, dur, (hadOld && !instant) ? 0.35 : 0.05, instant);   // new words only start once the old line is gone
  }
}

function toggleTextMode() {
  textMode = textMode === 'vertical' ? 'horizontal' : 'vertical';
  try { localStorage.setItem('rl-text-mode', textMode); } catch {}
  paintModeBtn();
  if (current) layout(current.text, current.dur, true);
}
const modeBtn = document.getElementById('b-mode');
function paintModeBtn() {
  const v = textMode === 'vertical';
  modeBtn.querySelector('path').setAttribute('d', v
    ? 'M12 4v16M7 9l5-5 5 5M7 15l5 5 5-5'                // up/down arrows
    : 'M4 12h16M9 7l-5 5 5 5M15 7l5 5-5 5');             // left/right arrows
  modeBtn.title = v ? 'Text: vertical roll  (click: standard horizontal)' : 'Text: standard horizontal  (click: vertical roll)';
}
modeBtn.onclick = toggleTextMode;
paintModeBtn();

async function onNewTrack(m) {
  const { title, artist } = clean(m);
  const key = title + '|' + artist;
  track = { key };
  lines = []; idx = -2;
  meta.textContent = `${title} · ${artist}`;
  layout(title, 2.5);
  const lrc = await window.api.getLyrics({ title, artist, album: m.album, duration: m.duration });
  if (!track || track.key !== key) return;
  if (lrc) lines = parseLRC(lrc);
  else layout('No synced lyrics found', 2.5);
}

window.api.onMood(h => setMoodHue(h));

window.api.onMedia(m => {
  if (!m.title) return;
  applyMediaTheme(m);
  Lightning.setPlaying(m.playing);
  const { title, artist } = clean(m);
  if (!track || track.key !== title + '|' + artist) { base = { pos: 0, t: 0, playing: false }; onNewTrack(m); }

  const now = performance.now();
  const expected = base.pos + (base.playing ? (now - base.t) / 1000 : 0);
  if (!base.t || Math.abs(expected - m.position) > 0.6 || base.playing !== m.playing)
    base = { pos: m.position, t: now, playing: m.playing };
});

function tick() {
  if (lines.length && base.t) {
    const p = base.pos + (base.playing ? (performance.now() - base.t) / 1000 : 0) + offset;
    let i = -1;
    for (let k = 0; k < lines.length; k++) { if (lines[k].t <= p) i = k; else break; }
    if (i !== idx) {
      idx = i;
      const next = lines[i + 1];
      const dur = i >= 0 && next ? Math.max(next.t - lines[i].t, 1) : 3;
      Lightning.kick();
      layout(i >= 0 ? lines[i].text : '♪', dur);
    }
  }
  requestAnimationFrame(tick);
}
tick();

// re-fit the text when the window is resized / maximised
let rt;
addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => current && layout(current.text, current.dur, true), 120);
});

// ---- window buttons ----
document.getElementById('b-min').onclick = () => window.api.win('min');
document.getElementById('b-max').onclick = () => window.api.win('max');
document.getElementById('b-close').onclick = () => window.api.win('close');
window.api.onMax(s => document.body.classList.toggle('max', s));

// ---- drag-to-resize grip ----
const grip = document.getElementById('grip');
grip.addEventListener('pointerdown', e => {
  grip.setPointerCapture(e.pointerId);
  const sx = e.screenX, sy = e.screenY, w0 = innerWidth, h0 = innerHeight;
  const move = ev => window.api.resize(w0 + ev.screenX - sx, h0 + ev.screenY - sy);
  const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
});

// ---- keyboard ----
addEventListener('keydown', e => {
  if (e.key === '[') offset -= 0.25;
  else if (e.key === ']') offset += 0.25;
  else if (e.code === 'Space') { e.preventDefault(); window.api.cmd('toggle'); }
  else if (e.key === 'ArrowRight') window.api.cmd('next');
  else if (e.key === 'ArrowLeft') window.api.cmd('prev');
  else if (e.key.toLowerCase() === 'f') window.api.win('max');
  else if (e.key.toLowerCase() === 'l') Lightning.cycle();
  else if (e.key.toLowerCase() === 'v') toggleTextMode();
  else return;
  if (e.key === '[' || e.key === ']')
    hint.textContent = `sync ${offset >= 0 ? '+' : ''}${offset.toFixed(2)}s`;
});
