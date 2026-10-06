// Ambient "car interior" light stream that travels around a rounded panel.
//  - follows the real rounded-rectangle outline (no square corners)
//  - constant speed, soft band with NO bright head / tail (not a comet)
//  - slowly fades on and off, nothing pulses or flickers
//  - colour comes from the album art / song vibe (setTheme.hue in theme.js)
function AmbientGlow({ canvas, panel, speed = 190, mode = 'move' }) {
  const SP = 5;                                        // point spacing along the outline (px)
  const ctx = canvas.getContext('2d');

  // second canvas, blurred by CSS, gives the soft bloom around the sharp light line
  const bloom = document.createElement('canvas');
  const z = parseInt(getComputedStyle(canvas).zIndex, 10) || 20;
  bloom.style.cssText = `position:fixed;left:0;top:0;pointer-events:none;z-index:${z - 1};filter:blur(9px) saturate(1.5)`;
  canvas.parentNode.insertBefore(bloom, canvas);
  const bctx = bloom.getContext('2d');

  // two soft bands, slightly different hues, each fading in/out on its own slow rhythm
  const bands = [
    { pos: 0.00, len: 0.30, period: 9,  phase: 0.0 },
    { pos: 0.52, len: 0.24, second: true, period: 13, phase: 2.4 },
  ];

  let pts = [], key = '', maxed = false, hue = 28, hue2 = 60, level = 1, playing = true, last = performance.now();
  // modes: 'move' = travelling stream, 'still' = steady even glow, 'off' = no light at all
  // mv / on ease 0..1 so switching modes cross-fades instead of jumping
  let wantMove = mode === 'move', mv = wantMove ? 1 : 0, wantOn = mode !== 'off', on = wantOn ? 1 : 0;

  function buildPath(x, y, w, h, r) {
    const out = [];
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    const line = (x0, y0, x1, y1, nx, ny) => {
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / SP));
      for (let i = 0; i < n; i++) { const t = i / n; out.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, nx, ny }); }
    };
    const arc = (cx, cy, a0, a1) => {
      const n = Math.max(1, Math.round(Math.abs(a1 - a0) * r / SP));
      for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * i / n; out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) }); }
    };
    line(x + r, y, x + w - r, y, 0, -1);        arc(x + w - r, y + r, -Math.PI / 2, 0);
    line(x + w, y + r, x + w, y + h - r, 1, 0); arc(x + w - r, y + h - r, 0, Math.PI / 2);
    line(x + w - r, y + h, x + r, y + h, 0, 1); arc(x + r, y + h - r, Math.PI / 2, Math.PI);
    line(x, y + h - r, x, y + r, -1, 0);        arc(x + r, y + r, Math.PI, Math.PI * 1.5);
    return out;
  }

  function ensure() {
    const r = panel.getBoundingClientRect();
    const rad = parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0;
    const dpr = window.devicePixelRatio || 1;
    const k = [innerWidth, innerHeight, r.left, r.top, r.width, r.height, rad, dpr].join();
    if (k === key) return;
    key = k;
    for (const cv of [canvas, bloom]) {
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
      cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
      cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    maxed = document.body.classList.contains('max');
    const inset = maxed ? 2 : 0;
    pts = buildPath(r.left + inset, r.top + inset, r.width - inset * 2, r.height - inset * 2, rad - inset);
  }

  const hsl = (h, l, a) => `hsl(${(h + 360) % 360} 100% ${l}% / ${a})`;

  function trace(c, i0, n, off) {
    const N = pts.length;
    c.beginPath();
    for (let j = 0; j <= n; j++) {
      const p = pts[(((i0 + j) % N) + N) % N];
      const x = p.x + p.nx * off, y = p.y + p.ny * off;
      j ? c.lineTo(x, y) : c.moveTo(x, y);
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    ensure();

    const target = (window.setTheme && setTheme.hue != null) ? setTheme.hue : 28;
    hue = (hue + (((target - hue + 540) % 360) - 180) * Math.min(1, dt * 2) + 360) % 360;
    const target2 = (window.setTheme && setTheme.hue2 != null) ? setTheme.hue2 : target + 30;
    hue2 = (hue2 + (((target2 - hue2 + 540) % 360) - 180) * Math.min(1, dt * 2) + 360) % 360;
    level += ((playing ? 1 : 0.25) - level) * Math.min(1, dt * 1.5);   // dims when paused
    mv += ((wantMove ? 1 : 0) - mv) * Math.min(1, dt * 3);
    on += ((wantOn ? 1 : 0) - on) * Math.min(1, dt * 3);

    ctx.clearRect(0, 0, innerWidth, innerHeight);
    bctx.clearRect(0, 0, innerWidth, innerHeight);

    if (pts.length && on > 0.01) {
      const N = pts.length, t = now / 1000;
      const rev = speed / (N * SP);                       // revolutions per second -> same px/s on any size
      const offCore = maxed ? -2.5 : 1.2, offBloom = maxed ? -4 : 3;
      ctx.globalCompositeOperation = bctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = bctx.lineJoin = 'round';
      ctx.lineCap = bctx.lineCap = 'butt';

      // very faint steady outline so the edge never disappears completely
      trace(ctx, 0, N, offCore);
      ctx.lineWidth = 1.2; ctx.strokeStyle = hsl(hue, 65, (0.16 * level + 0.04) * on); ctx.stroke();

      // stationary mode: an even, steady glow all the way round the rounded outline
      const st = (1 - mv) * level * on;
      if (st > 0.01) {
        trace(bctx, 0, N, offBloom); bctx.lineWidth = 9;   bctx.strokeStyle = hsl(hue, 58, st * 0.55); bctx.stroke();
        trace(ctx, 0, N, offCore);
        ctx.lineWidth = 5;   ctx.strokeStyle = hsl(hue, 68, st * 0.16); ctx.stroke();
        ctx.lineWidth = 2.2; ctx.strokeStyle = hsl(hue, 80, st * 0.6);  ctx.stroke();
      }

      for (const b of bands) {
        if (wantMove) b.pos = (b.pos + rev * dt) % 1;
        // slow on/off envelope (eased, no flicker)
        const s = Math.sin(t * 2 * Math.PI / b.period + b.phase);
        let e = Math.min(1, Math.max(0, (s + 0.2) / 0.8));
        e = e * e * (3 - 2 * e);
        const env = e * level * mv * on;
        if (env < 0.01) continue;

        const len = N * b.len, centre = b.pos * N - len / 2, L = 14, h = b.second ? hue2 : hue;
        // nested continuous strokes: widest one is faint, the middle one stacks up to full brightness.
        // No segment joins, so no seams, and the band fades softly at both ends (no head, no tail).
        for (let j = 0; j < L; j++) {
          const d = (2 / Math.PI) * Math.acos(Math.pow(j / L, 1 / 1.7));   // how much of the band this layer covers
          const half = len / 2 * d;
          if (half < 1) continue;
          const i0 = Math.round(centre - half), n = Math.max(2, Math.round(half * 2));

          trace(bctx, i0, n, offBloom);
          bctx.lineWidth = 9; bctx.strokeStyle = hsl(h, 58, env * 0.9 / L * 1.6); bctx.stroke();

          trace(ctx, i0, n, offCore);
          ctx.lineWidth = 5;   ctx.strokeStyle = hsl(h, 68, env * 0.22 / L * 1.6); ctx.stroke();
          ctx.lineWidth = 2.2; ctx.strokeStyle = hsl(h, 82, env * 0.95 / L * 1.6); ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = bctx.globalCompositeOperation = 'source-over';
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setPlaying(p) { playing = !!p; },
    setMode(m) { wantMove = m === 'move'; wantOn = m !== 'off'; },
  };
}


// One button that cycles the light: moving -> stationary -> off. Remembers the choice per window.
function GlowToggle({ button, glow, storeKey, onChange }) {
  const MODES = ['move', 'still', 'off'];
  const ICON = {
    move:  'M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4',                       // circular arrows
    still: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z', // sun
    off:   'M20 14.5A8.5 8.5 0 1 1 9.5 4a6.7 6.7 0 0 0 10.5 10.5z',                                  // moon
  };
  const TIP = {
    move: 'Light: moving  (click: stationary)',
    still: 'Light: stationary  (click: off)',
    off: 'Light: off  (click: moving)',
  };
  let mode = 'move';
  try { const s = localStorage.getItem(storeKey); if (MODES.includes(s)) mode = s; } catch {}
  const path = button.querySelector('path');
  function paint() {
    path.setAttribute('d', ICON[mode]);
    button.title = TIP[mode];
    button.dataset.mode = mode;
  }
  function set(m) {
    mode = m; glow.setMode(m); paint();
    try { localStorage.setItem(storeKey, m); } catch {}
    onChange && onChange(m);
  }
  button.addEventListener('click', () => set(MODES[(MODES.indexOf(mode) + 1) % MODES.length]));
  glow.setMode(mode); paint();
  return { cycle: () => button.click(), get mode() { return mode; } };
}
