/* Black hole hero — canvas 2D: starfield + rotating accretion disk + photon ring */
(function () {
  const canvas = document.getElementById('blackhole');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, CX = 0, CY = 0, R = 0;
  let stars = [];
  let parts = [];
  let mx = 0, my = 0, tmx = 0, tmy = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    CX = W / 2; CY = H * 0.44;
    R = Math.min(W, H) * 0.13;
    stars = Array.from({ length: Math.floor(W * H / 4500) }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.3 + 0.2, p: Math.random() * Math.PI * 2,
      s: 0.5 + Math.random() * 2
    }));
    parts = Array.from({ length: 700 }, () => {
      const orbit = Math.pow(Math.random(), 0.7); // 0 inner .. 1 outer
      return {
        a: Math.random() * Math.PI * 2,
        orbit,
        w: (0.9 - orbit * 0.65) * (0.25 + Math.random() * 0.35),
        sz: 0.6 + Math.random() * 2.2 * (1 - orbit * 0.5),
        hue: 28 + Math.random() * 22 - orbit * 12
      };
    });
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    tmx = (e.clientX - r.left - r.width / 2) / r.width;
    tmy = (e.clientY - r.top - r.height / 2) / r.height;
  });
  resize();

  const TILT = 0.38; // vertical squash of disk ellipse
  let t = 0;

  function frame() {
    t += 0.016;
    mx += (tmx - mx) * 0.04;
    my += (tmy - my) * 0.04;
    const ox = mx * 14, oy = my * 10;

    ctx.clearRect(0, 0, W, H);

    // stars
    for (const s of stars) {
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * s.s + s.p));
      ctx.globalAlpha = tw * 0.9;
      ctx.fillStyle = '#e8e4da';
      ctx.beginPath();
      ctx.arc(s.x + ox * 0.3, s.y + oy * 0.3, s.r, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const px = CX + ox, py = CY + oy;
    const inner = R * 1.25, outer = R * 3.4;

    // back half of disk (behind the hole)
    drawDisk(px, py, inner, outer, true);

    // ambient glow
    const g = ctx.createRadialGradient(px, py, R * 0.4, px, py, outer * 1.5);
    g.addColorStop(0, 'rgba(255,150,60,0.28)');
    g.addColorStop(0.4, 'rgba(255,120,40,0.10)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px - outer * 1.6, py - outer - R, outer * 3.2, outer * 2 + R * 2);

    // the black hole itself
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(px, py, R, 0, 7); ctx.fill();
    // faint rim light at bottom from disk
    const rim = ctx.createRadialGradient(px, py + R * 0.9, R * 0.1, px, py + R * 0.9, R * 1.5);
    rim.addColorStop(0, 'rgba(255,170,80,0.5)');
    rim.addColorStop(1, 'rgba(255,170,80,0)');
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(px, py, R * 1.02, 0, 7); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(px, py, R * 0.97, 0, 7); ctx.fill();

    // photon ring
    ctx.save();
    ctx.translate(px, py); ctx.scale(1, TILT);
    ctx.strokeStyle = 'rgba(255,220,170,0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.12, 0, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,150,60,0.25)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.16, 0, 7); ctx.stroke();
    ctx.restore();

    // front half of disk (in front of the hole)
    drawDisk(px, py, inner, outer, false);

    if (!reduce) requestAnimationFrame(frame);
  }

  function drawDisk(px, py, inner, outer, back) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      const ang = p.a + t * p.w;
      // only back or front half
      const sy = Math.sin(ang);
      if (back && sy > 0) continue;
      if (!back && sy <= 0) continue;
      const rad = inner + p.orbit * (outer - inner);
      const x = px + Math.cos(ang) * rad;
      const y = py + sy * rad * TILT;
      // doppler beaming: left side brighter
      const beam = 0.45 + 0.55 * (0.5 - 0.5 * Math.cos(ang));
      const heat = 1 - p.orbit; // hotter inside
      ctx.globalAlpha = (0.12 + heat * 0.5) * beam + 0.06;
      ctx.fillStyle = `hsl(${p.hue + heat * 14} 95% ${42 + heat * 22}%)`;
      ctx.beginPath();
      ctx.arc(x, y, p.sz * (1 + heat * 0.7), 0, 7);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  if (reduce) { t = 3; frame(); } else { requestAnimationFrame(frame); }
})();
