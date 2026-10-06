const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');

let win, card, helper;
let maxed = false, saved = null;
const prefs = { preload: path.join(__dirname, 'preload.js'), autoplayPolicy: 'no-user-gesture-required' };

function createWindows() {
  const wa = screen.getPrimaryDisplay().workArea;

  // lyrics window: transparent so the glow can spill outside the black panel
  const W = 1060, H = 660;
  win = new BrowserWindow({
    width: W, height: H,
    x: wa.x + Math.round((wa.width - W) / 2), y: wa.y + Math.round((wa.height - H) / 2),
    frame: false, transparent: true, hasShadow: false, resizable: false,
    backgroundColor: '#00000000', webPreferences: prefs,
  });
  win.setAlwaysOnTop(true, 'floating');
  win.loadFile('index.html');
  win.on('closed', () => app.quit());

  // glass player card with controls, bottom right
  card = new BrowserWindow({
    width: 420, height: 250, x: wa.x + wa.width - 420, y: wa.y + wa.height - 250,   // extra transparent room so the glow isn't clipped
    frame: false, transparent: true, hasShadow: false, resizable: false, skipTaskbar: true,
    backgroundColor: '#00000000', webPreferences: prefs,
  });
  card.setAlwaysOnTop(true, 'screen-saver');
  card.loadFile('card.html');
}

function toggleMax() {
  if (!win) return;
  if (!maxed) {
    saved = win.getBounds();
    win.setAlwaysOnTop(true, 'screen-saver');          // sits above the taskbar
    win.setBounds(screen.getDisplayMatching(saved).bounds);   // whole screen, not just the work area
  } else {
    win.setAlwaysOnTop(true, 'floating');
    if (saved) win.setBounds(saved);
  }
  maxed = !maxed;
  win.webContents.send('maxstate', maxed);
  if (card && !card.isDestroyed()) card.moveTop();     // keep the player card visible on top
}

function startHelper(cmd, args) {
  const script = path.join(__dirname, '..', 'helper', 'media.py');
  helper = spawn(cmd, [...args, script]);
  helper.on('error', () => {
    if (cmd === 'python') { console.log('python not found, trying "py"...'); startHelper('py', ['-3']); }
    else console.error('Could not start Python. Install Python from python.org and tick "Add to PATH".');
  });
  helper.stdin.on('error', () => {});
  readline.createInterface({ input: helper.stdout }).on('line', line => {
    try {
      const m = JSON.parse(line);
      [win, card].forEach(w => w && !w.isDestroyed() && w.webContents.send('media', m));
    } catch {}
  });
  helper.stderr.on('data', d => console.error(String(d)));
}

ipcMain.on('media-cmd', (_, c) => {
  if (['toggle', 'next', 'prev'].includes(c) && helper && helper.stdin.writable) helper.stdin.write(c + '\n');
});
ipcMain.on('win-action', (_, a) => {
  if (a === 'close') app.quit();
  else if (a === 'min') win.minimize();
  else if (a === 'max') toggleMax();
});
ipcMain.on('win-resize', (_, { w, h }) => {
  if (maxed || !win) return;
  const b = win.getBounds();
  win.setBounds({ x: b.x, y: b.y, width: Math.max(720, Math.round(w)), height: Math.max(520, Math.round(h)) });
});

// ---- mood of the song, worked out from the lyrics: keyword groups -> a hue ----
const MOODS = [
  { hue: 345, re: /\b(love|loving|heart|kiss|baby|darling|desire|touch|honey|sweet|romance|hold me|mine)\b/g },
  { hue: 8,   re: /\b(fire|burn|burning|hot|devil|danger|blood|red|rage|fight|war|kill|hell|smoke)\b/g },
  { hue: 45,  re: /\b(sun|sunshine|summer|gold|golden|happy|smile|dance|dancing|party|shine|shining|joy|laugh|good)\b/g },
  { hue: 215, re: /\b(sad|cry|crying|tears|alone|lonely|goodbye|miss|hurt|pain|broken|rain|blue|empty|lost|sorry)\b/g },
  { hue: 268, re: /\b(night|dark|moon|midnight|dream|dreams|star|stars|ghost|sleep|shadow|shadows|angel|heaven|magic)\b/g },
  { hue: 190, re: /\b(ocean|sea|water|wave|waves|sky|fly|flying|free|wind|cloud|clouds|float|drift|blue sky)\b/g },
  { hue: 140, re: /\b(green|forest|nature|grow|growing|spring|earth|home|garden|tree|trees|flower|flowers|river)\b/g },
];
function moodHue(text, seed) {
  const t = (text || '').toLowerCase();
  let best = null, bestN = 0;
  for (const m of MOODS) {
    const n = (t.match(m.re) || []).length;
    if (n > bestN) { bestN = n; best = m; }
  }
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const jitter = (h % 25) - 12;                           // songs with the same mood still differ slightly
  if (best) return (best.hue + jitter + 360) % 360;
  return (h * 137.508) % 360;                             // no mood words at all: a hue unique to the song
}
function sendMood(hue) {
  [win, card].forEach(w => w && !w.isDestroyed() && w.webContents.send('mood', hue));
}

ipcMain.handle('lyrics', async (_, { title, artist, album, duration }) => {
  const headers = { 'User-Agent': 'Lyriscence/0.2 (personal project)' };
  const base = 'https://lrclib.net/api';
  try {
    const p = new URLSearchParams({ track_name: title, artist_name: artist });
    if (album) p.set('album_name', album);
    if (duration > 0) p.set('duration', Math.round(duration));
    let r = await fetch(`${base}/get?${p}`, { headers });
    if (r.ok) { const j = await r.json(); sendMood(moodHue(j.syncedLyrics || j.plainLyrics, artist + title)); if (j.syncedLyrics) return j.syncedLyrics; }

    r = await fetch(`${base}/search?q=${encodeURIComponent(artist + ' ' + title)}`, { headers });
    if (r.ok) {
      const list = (await r.json()).filter(x => x.syncedLyrics);
      list.sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration));
      if (list[0] && (!duration || Math.abs(list[0].duration - duration) < 8)) { sendMood(moodHue(list[0].syncedLyrics, artist + title)); return list[0].syncedLyrics; }
    }
  } catch (e) { console.error(e); }
  return null;
});

app.whenReady().then(() => {
  createWindows();
  startHelper('python', []);
});
app.on('will-quit', () => helper && helper.kill());
