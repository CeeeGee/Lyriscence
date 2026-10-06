// Border light for the lyrics window (ambient stream, see glow.js)
const Lightning = (() => {
  const glow = AmbientGlow({
    canvas: document.getElementById('fx'),
    panel: document.querySelector('.panel'),
    speed: 190,
  });
  const toggle = GlowToggle({ button: document.getElementById('b-fx'), glow, storeKey: 'rl-main-glow' });
  return { setPlaying: p => glow.setPlaying(p), kick() {}, cycle: () => toggle.cycle() };
})();
