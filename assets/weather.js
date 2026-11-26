/* src/renderer/shared/util.js */
/* Shared helpers for the overlay engine and the wallpaper painter. Plain script, no modules. */
(function () {
  'use strict';
  const Drift = (window.Drift = window.Drift || {});

  // Small, fast, seedable PRNG.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Smooth 1D value noise in roughly [-1, 1].
  function makeNoise1D(seed) {
    const rnd = mulberry32(seed);
    const N = 512;
    const table = new Float32Array(N);
    for (let i = 0; i < N; i++) table[i] = rnd() * 2 - 1;
    return function (x) {
      const xi = Math.floor(x);
      const t = x - xi;
      const a = table[((xi % N) + N) % N];
      const b = table[(((xi + 1) % N) + N) % N];
      const s = t * t * (3 - 2 * t);
      return a + (b - a) * s;
    };
  }

  // Fractal (multi-octave) 1D noise.
  function makeFbm1D(seed, octaves) {
    const layers = [];
    for (let i = 0; i < octaves; i++) layers.push(makeNoise1D(seed + i * 101));
    return function (x) {
      let sum = 0;
      let amp = 1;
      let freq = 1;
      let norm = 0;
      for (let i = 0; i < octaves; i++) {
        sum += layers[i](x * freq) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
      }
      return sum / norm;
    };
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mixRgb(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }

  function rgba(c, alpha) {
    const a = alpha === undefined ? 1 : alpha;
    return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
  }

  function mixHex(a, b, t) {
    return mixRgb(hexToRgb(a), hexToRgb(b), t);
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  // Subtract [a, b] from a list of disjoint, sorted intervals.
  function subtractInterval(intervals, a, b) {
    const out = [];
    for (const [s, e] of intervals) {
      if (b <= s || a >= e) {
        out.push([s, e]);
        continue;
      }
      if (a > s) out.push([s, a]);
      if (b < e) out.push([b, e]);
    }
    return out;
  }

  Drift.util = {
    mulberry32, makeNoise1D, makeFbm1D, clamp, lerp, smooth, rand, pick,
    hexToRgb, mixRgb, mixHex, rgba, makeCanvas, subtractInterval,
  };
})();

/* src/renderer/overlay/sprites.js */
/* Pre-rendered particle images. Drawing bitmaps is far cheaper than building paths every frame. */
(function () {
  'use strict';
  const Drift = window.Drift;
  const U = Drift.util;

  const FLAKE_RADII = [0.8, 1.1, 1.4, 1.8, 2.2, 2.7, 3.2, 3.8, 4.6, 5.6, 6.6];
  const PETAL_COLORS = ['#ffc4d6', '#ffb0c8', '#fcd3df', '#ffdbe6', '#f6a3bd', '#fff0f5'];
  const HEART_COLORS = ['#e8364f', '#ff5a77', '#ff8fa8', '#d81e45', '#ffb3c4', '#f0426a'];
  const LEAF_COLORS = ['#d9531e', '#e8862a', '#f2b134', '#b8401f', '#9a5b2a', '#cf6f2a', '#e6a23a', '#a5361f'];

  // Soft white dot with a faint dark rim so it stays visible over white windows.
  function flake(r, dpr, haloStrength) {
    const pad = 2.5;
    const size = (r + pad) * 2;
    const c = U.makeCanvas(size * dpr, size * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const m = size / 2;
    const halo = g.createRadialGradient(m, m, r * 0.5, m, m, r + 1.8);
    // Tiny flakes get almost no rim (they would read as rings on white); big ones a clear one.
    const ha = (haloStrength === undefined ? 0.34 : haloStrength) * U.clamp((r - 0.5) / 2.2, 0.15, 1);
    halo.addColorStop(0, `rgba(40,60,95,${ha.toFixed(3)})`);
    halo.addColorStop(1, 'rgba(40,60,95,0)');
    g.fillStyle = halo;
    g.beginPath();
    g.arc(m, m, r + 1.8, 0, Math.PI * 2);
    g.fill();
    const core = g.createRadialGradient(m, m, 0, m, m, r);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.55, 'rgba(255,255,255,0.92)');
    core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core;
    g.beginPath();
    g.arc(m, m, r, 0, Math.PI * 2);
    g.fill();
    return { c, r: m, size };
  }

  // Six-armed ice crystal.
  function crystal(r, dpr, variant) {
    const pad = 2;
    const size = (r + pad) * 2;
    const c = U.makeCanvas(size * dpr, size * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.translate(size / 2, size / 2);
    const arms = () => {
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        g.moveTo(0, 0);
        g.lineTo(ca * r, sa * r);
        const b1 = r * (variant ? 0.45 : 0.55);
        const bl = r * 0.32;
        for (const sgn of [-1, 1]) {
          const ba = a + sgn * 0.75;
          g.moveTo(ca * b1, sa * b1);
          g.lineTo(ca * b1 + Math.cos(ba) * bl, sa * b1 + Math.sin(ba) * bl);
        }
        if (variant) {
          const b2 = r * 0.75;
          const bl2 = r * 0.2;
          for (const sgn of [-1, 1]) {
            const ba = a + sgn * 0.8;
            g.moveTo(ca * b2, sa * b2);
            g.lineTo(ca * b2 + Math.cos(ba) * bl2, sa * b2 + Math.sin(ba) * bl2);
          }
        }
      }
    };
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(40,60,90,0.22)';
    g.lineWidth = 2.2;
    arms();
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.97)';
    g.lineWidth = 1.1;
    arms();
    g.stroke();
    return { c, r: size / 2, size };
  }

  // Sakura petal with the little notch at its tip. Base size B (CSS px).
  function petal(color, dpr) {
    const B = 22;
    const c = U.makeCanvas(B * dpr, B * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.translate(B / 2, B / 2);
    const L = B * 0.86;
    const W = B * 0.62;
    g.beginPath();
    g.moveTo(0, L * 0.5);
    g.bezierCurveTo(W * 0.62, L * 0.3, W * 0.6, -L * 0.32, W * 0.2, -L * 0.5);
    g.lineTo(0, -L * 0.36);
    g.lineTo(-W * 0.2, -L * 0.5);
    g.bezierCurveTo(-W * 0.6, -L * 0.32, -W * 0.62, L * 0.3, 0, L * 0.5);
    g.closePath();
    const base = U.hexToRgb(color);
    const grad = g.createLinearGradient(0, L * 0.5, 0, -L * 0.5);
    grad.addColorStop(0, U.rgba(U.mixRgb(base, [214, 92, 130], 0.45)));
    grad.addColorStop(0.5, U.rgba(base));
    grad.addColorStop(1, U.rgba(U.mixRgb(base, [255, 255, 255], 0.35)));
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'rgba(180,70,105,0.4)';
    g.lineWidth = 0.9;
    g.stroke();
    return { c, w: B, h: B };
  }

  // A little paper heart, for the letters' sky (src/renderer/overlay/letters.js). Base size B (CSS px).
  function heart(color, dpr) {
    const B = 22;
    const c = U.makeCanvas(B * dpr, B * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.translate(B / 2, B / 2 + 0.5);
    const r = B * 0.44;
    g.beginPath();
    g.moveTo(0, r * 0.95);
    g.bezierCurveTo(-r * 1.25, r * 0.05, -r * 0.95, -r * 1.05, 0, -r * 0.42);
    g.bezierCurveTo(r * 0.95, -r * 1.05, r * 1.25, r * 0.05, 0, r * 0.95);
    g.closePath();
    const base = U.hexToRgb(color);
    const grad = g.createLinearGradient(-r, -r, r, r);
    grad.addColorStop(0, U.rgba(U.mixRgb(base, [255, 255, 255], 0.3)));
    grad.addColorStop(0.55, U.rgba(base));
    grad.addColorStop(1, U.rgba(U.mixRgb(base, [120, 10, 40], 0.35)));
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'rgba(140,20,50,0.35)';
    g.lineWidth = 0.8;
    g.stroke();
    // a soft shine on the left lobe
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.ellipse(-r * 0.45, -r * 0.42, r * 0.22, r * 0.13, -0.6, 0, Math.PI * 2);
    g.fill();
    return { c, w: B, h: B };
  }

  // Autumn leaves: 0 = maple, 1 = oval, 2 = long.
  function leaf(shape, color, dpr) {
    const B = 34;
    const c = U.makeCanvas(B * dpr, B * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.translate(B / 2, B / 2);
    const col = U.hexToRgb(color);
    const dark = U.rgba(U.mixRgb(col, [60, 25, 10], 0.45));
    g.beginPath();
    if (shape === 0) {
      const R = B * 0.46;
      const steps = 90;
      for (let k = 0; k <= steps; k++) {
        // th = 0 points up; |cos(2.5 th)| peaks five times: one lobe on top, valley at the stem
        const th = (k / steps) * Math.PI * 2;
        const lobes = Math.pow(Math.abs(Math.cos(th * 2.5)), 1.8);
        const teeth = 0.07 * Math.abs(Math.sin(th * 15));
        let r = R * (0.36 + 0.6 * lobes + teeth);
        const down = Math.max(0, -Math.cos(th));
        r *= 1 - 0.35 * Math.pow(down, 6);
        const x = Math.sin(th) * r;
        const y = -Math.cos(th) * r;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    } else {
      const L = shape === 1 ? B * 0.42 : B * 0.47;
      const W = shape === 1 ? B * 0.27 : B * 0.15;
      g.moveTo(0, L);
      g.bezierCurveTo(W * 1.4, L * 0.4, W * 1.2, -L * 0.6, 0, -L);
      g.bezierCurveTo(-W * 1.2, -L * 0.6, -W * 1.4, L * 0.4, 0, L);
    }
    g.closePath();
    const grad = g.createLinearGradient(-B / 2, -B / 2, B / 2, B / 2);
    grad.addColorStop(0, U.rgba(U.mixRgb(col, [255, 230, 150], 0.25)));
    grad.addColorStop(1, U.rgba(U.mixRgb(col, [90, 30, 10], 0.25)));
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = dark;
    g.globalAlpha = 0.6;
    g.lineWidth = 1;
    g.stroke();
    // veins and stem
    g.globalAlpha = 0.5;
    g.lineWidth = 1.1;
    g.beginPath();
    if (shape === 0) {
      for (const a of [-Math.PI / 2, -Math.PI / 2 - 1.25, -Math.PI / 2 + 1.25, -Math.PI / 2 - 2.4, -Math.PI / 2 + 2.4]) {
        g.moveTo(0, B * 0.08);
        g.lineTo(Math.cos(a) * B * 0.38, Math.sin(a) * B * 0.38 + B * 0.08);
      }
      g.moveTo(0, B * 0.08);
      g.lineTo(0, B * 0.48);
    } else {
      const L = shape === 1 ? B * 0.42 : B * 0.47;
      g.moveTo(0, L + B * 0.06);
      g.lineTo(0, -L * 0.85);
      for (let k = -2; k <= 2; k++) {
        const y = k * L * 0.3;
        g.moveTo(0, y);
        g.lineTo(L * 0.35, y - L * 0.25);
        g.moveTo(0, y);
        g.lineTo(-L * 0.35, y - L * 0.25);
      }
    }
    g.strokeStyle = dark;
    g.stroke();
    return { c, w: B, h: B };
  }

  function glow(radius, dpr, stops) {
    const size = radius * 2;
    const c = U.makeCanvas(size * dpr, size * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const gr = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return { c, r: radius, size };
  }

  Drift.buildSprites = function (dpr, sizeSetting) {
    const s = {
      flakeRadii: FLAKE_RADII,
      flakes: FLAKE_RADII.map((r) => flake(r, dpr)),
      clumps: FLAKE_RADII.map((r) => flake(r, dpr, 0.14)),
      crystals: [crystal(5, dpr, 0), crystal(6, dpr, 1), crystal(7, dpr, 1)],
      petals: PETAL_COLORS.map((c) => petal(c, dpr)),
      hearts: HEART_COLORS.map((c) => heart(c, dpr)),
      leaves: [],
      firefly: glow(16, dpr, [
        [0, 'rgba(250,255,190,0.95)'], [0.18, 'rgba(225,255,120,0.55)'],
        [0.5, 'rgba(190,245,80,0.16)'], [1, 'rgba(170,240,60,0)'],
      ]),
      spark: glow(7, dpr, [
        [0, 'rgba(255,255,240,1)'], [0.3, 'rgba(255,225,150,0.75)'], [1, 'rgba(255,190,90,0)'],
      ]),
      blueSpark: glow(7, dpr, [
        [0, 'rgba(255,255,255,1)'], [0.3, 'rgba(190,215,255,0.75)'], [1, 'rgba(140,180,255,0)'],
      ]),
      size: sizeSetting,
    };
    for (let k = 0; k < LEAF_COLORS.length; k++) {
      s.leaves.push(leaf(k % 3, LEAF_COLORS[k], dpr));
      s.leaves.push(leaf((k + 1) % 3, LEAF_COLORS[(k + 3) % LEAF_COLORS.length], dpr));
    }
    return s;
  };

  // Index of the closest pre-rendered flake radius.
  Drift.flakeIndex = function (r) {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < FLAKE_RADII.length; i++) {
      const d = Math.abs(FLAKE_RADII[i] - r);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
})();

/* src/renderer/overlay/effects.js */
/* Particle types (how each thing moves, lands and is drawn) and the six weathers that spawn them. */
(function () {
  'use strict';
  const Drift = window.Drift;
  const U = Drift.util;
  const TAU = Math.PI * 2;

  const types = (Drift.types = {});
  Drift.drawOrder = ['flake', 'clump', 'puff', 'drop', 'splash', 'ring', 'petal', 'heart', 'leaf', 'fly',
    'meteor', 'spark', 'glitter', 'confetti'];

  const offscreen = (p, e) => p.y > e.H + 30 || p.x < -220 || p.x > e.W + 220 || p.y < -400;

  // Spawn x so that, after drifting with the wind on the way down, particles cover the screen evenly.
  function spawnX(e, drift) {
    return U.rand(-80, e.W + 80) - drift;
  }

  function drawSpriteAt(ctx, spr, x, y, scale) {
    const s = spr.size * scale;
    ctx.drawImage(spr.c, x - s / 2, y - s / 2, s, s);
  }

  // ------------------------------------------------------------------ snow
  types.flake = {
    update(p, dt, e) {
      const sway = Math.sin(e.time * p.freq + p.phase) * p.swayAmp;
      const tvx = e.windX * 55 * (0.5 + p.d) + sway;
      p.vx += (tvx - p.vx) * Math.min(1, dt * 1.6);
      p.vy += (p.vt - p.vy) * Math.min(1, dt * 1.2);
      e.push(p, 110, 5, 70, dt);
      const py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.crystal) p.rot += p.vrot * dt;
      if (p.vy > 0) {
        const hit = e.findHit(p.x, py, p.y, p.d > 0.6);
        if (hit) {
          hit.surface.deposit(p.x, p.dep);
          if (p.r > 2.4 && Math.random() < 0.2) puff(e, p.x, hit.top, 2);
          return false;
        }
      }
      return !offscreen(p, e);
    },
    draw(ctx, pool, e) {
      const sp = e.sprites;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        ctx.globalAlpha = p.alpha;
        if (p.crystal) {
          const spr = sp.crystals[p.ci];
          const c = Math.cos(p.rot);
          const s = Math.sin(p.rot);
          const k = p.r / (spr.size / 2 - 2);
          ctx.setTransform(e.dpr * c * k, e.dpr * s * k, -e.dpr * s * k, e.dpr * c * k, e.dpr * p.x, e.dpr * p.y);
          ctx.drawImage(spr.c, -spr.size / 2, -spr.size / 2, spr.size, spr.size);
          ctx.setTransform(e.dpr, 0, 0, e.dpr, 0, 0);
        } else {
          const spr = sp.flakes[p.si];
          ctx.drawImage(spr.c, p.x - spr.r, p.y - spr.r, spr.size, spr.size);
        }
      }
      ctx.globalAlpha = 1;
    },
  };

  function spawnFlake(e, initial) {
    // Christmas: storybook snow, with bigger, slower flakes that sway more and many more crystals
    const story = !!(e.festive && e.festive.storybook);
    const d = Math.pow(Math.random(), story ? 1.05 : 1.4);
    const size = e.settings.size;
    const r = U.lerp(0.85, 3.3, d) * size * (story ? 1.12 : 1);
    const vt = U.lerp(32, 92, d) * (story ? 0.68 : 1);
    const crystal = story ? d > 0.45 && Math.random() < 0.3 : d > 0.62 && Math.random() < 0.09;
    const drift = e.windX * 55 * (0.5 + d) * ((e.H * 0.5) / vt);
    const p = {
      x: spawnX(e, drift),
      y: initial ? U.rand(-20, e.H) : U.rand(-40, -8),
      vx: e.windX * 55 * (0.5 + d),
      vy: vt,
      vt,
      d,
      r: crystal ? r * 1.6 + 1.5 : r,
      swayAmp: U.rand(6, 22) * (0.6 + d) * (story ? 1.5 : 1),
      freq: U.rand(0.6, 1.7),
      phase: U.rand(0, TAU),
      alpha: U.lerp(0.5, 1, d),
      crystal,
      rot: U.rand(0, TAU),
      vrot: U.rand(-0.8, 0.8),
      ci: (Math.random() * 3) | 0,
      dep: 0,
      si: 0,
    };
    p.si = Drift.flakeIndex(p.r);
    // Height this flake adds to a pile: its area, packed a little, spread over a cell.
    p.dep = (Math.PI * p.r * p.r * 0.34) / Drift.CELL;
    return e.add('flake', p);
  }

  function puff(e, x, y, n) {
    for (let k = 0; k < n; k++) {
      e.add('puff', {
        x: x + U.rand(-2, 2), y: y - 1,
        vx: U.rand(-35, 35), vy: U.rand(-60, -15),
        r: U.rand(0.8, 1.6), life: 0, max: U.rand(0.35, 0.7),
      });
    }
  }

  types.clump = {
    update(p, dt, e) {
      if (p.ox === undefined) {
        const a = Math.random() * TAU;
        p.ox = Math.cos(a);
        p.oy = Math.sin(a);
      }
      p.life += dt;
      p.vy += 900 * dt;
      p.vx *= Math.exp(-dt * 1.2);
      const py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.vy > 0 && p.life > 0.04) {
        const hit = e.findHit(p.x, py, p.y);
        if (hit) {
          hit.surface.deposit(p.x, p.vol / Drift.CELL);
          puff(e, p.x, hit.top, 2);
          return false;
        }
      }
      return p.life < 8 && !offscreen(p, e);
    },
    draw(ctx, pool, e) {
      const sp = e.sprites.clumps;
      ctx.globalAlpha = 1;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        // An irregular little cluster rather than a perfect ball.
        const a = sp[Drift.flakeIndex(p.r)];
        const b = sp[Drift.flakeIndex(p.r * 0.7)];
        const o = p.r * 0.55;
        ctx.drawImage(a.c, p.x - a.r, p.y - a.r, a.size, a.size);
        ctx.drawImage(b.c, p.x + o * p.ox - b.r, p.y + o * p.oy - b.r, b.size, b.size);
        ctx.drawImage(b.c, p.x - o * p.oy - b.r, p.y + o * p.ox * 0.6 - b.r, b.size, b.size);
      }
    },
  };

  types.puff = {
    update(p, dt) {
      p.life += dt;
      p.vy += 160 * dt;
      p.vx *= Math.exp(-dt * 3);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      return p.life < p.max;
    },
    draw(ctx, pool, e) {
      const sp = e.sprites;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        ctx.globalAlpha = 1 - p.life / p.max;
        const spr = sp.flakes[Drift.flakeIndex(p.r)];
        ctx.drawImage(spr.c, p.x - spr.r, p.y - spr.r, spr.size, spr.size);
      }
      ctx.globalAlpha = 1;
    },
  };

  // ------------------------------------------------------------------ rain
  const UMBRELLA_R = 62;

  types.drop = {
    update(p, dt, e) {
      p.vx += (e.windX * 170 * (0.6 + p.d * 0.6) - p.vx) * Math.min(1, dt * 3);
      const px = p.x;
      const py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const c = e.cursor;
      if (c.on && e.settings.interactive && p.y <= c.y + 2) {
        // The pointer is an umbrella: drops that reach its dome splash off it.
        const d0 = Math.hypot(px - c.x, py - c.y);
        const d1 = Math.hypot(p.x - c.x, p.y - c.y);
        if (d0 >= UMBRELLA_R && d1 < UMBRELLA_R) {
          const nx = (p.x - c.x) / (d1 || 1);
          splash(e, p.x, p.y, 2, nx * 140, false);
          return false;
        }
      }
      const hit = e.findHit(p.x, py, p.y, p.d > 0.55);
      if (hit) {
        splash(e, p.x, hit.top, p.d > 0.5 ? 3 : 2, 0, hit.surface.kind !== 'window');
        return false;
      }
      return !offscreen(p, e);
    },
    draw(ctx, pool) {
      // Two passes (far and near) so the batch needs only two stroke calls.
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        for (let i = 0; i < pool.length; i++) {
          const p = pool[i];
          if ((p.d > 0.5) !== (pass === 1)) continue;
          const k = p.len / Math.hypot(p.vx, p.vy);
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * k, p.y - p.vy * k);
        }
        ctx.strokeStyle = pass ? 'rgba(165,188,218,0.62)' : 'rgba(165,188,218,0.34)';
        ctx.lineWidth = pass ? 1.25 : 0.8;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    },
  };

  function spawnDrop(e, initial) {
    const d = Math.random();
    const vy = U.rand(900, 1300) * (0.8 + d * 0.35);
    const vx = e.windX * 170 * (0.6 + d * 0.6);
    const drift = vx * ((e.H * 0.5) / vy);
    return e.add('drop', {
      x: spawnX(e, drift),
      y: initial ? U.rand(-40, e.H) : U.rand(-80, -10),
      vx, vy, d,
      len: U.rand(10, 22) * (0.6 + d * 0.7),
    });
  }

  function splash(e, x, y, n, vxBias, ring) {
    for (let k = 0; k < n; k++) {
      e.add('splash', {
        x, y: y - 1,
        vx: U.rand(-70, 70) + vxBias, vy: U.rand(-160, -60),
        life: 0, max: U.rand(0.22, 0.4),
      });
    }
    if (ring && e.count('ring') < 80) e.add('ring', { x, y: y - 0.5, life: 0, max: 0.35 });
  }

  types.splash = {
    update(p, dt) {
      p.life += dt;
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      return p.life < p.max;
    },
    draw(ctx, pool) {
      ctx.fillStyle = 'rgba(175,198,226,0.8)';
      ctx.beginPath();
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        ctx.moveTo(p.x + 1, p.y);
        ctx.arc(p.x, p.y, 1, 0, TAU);
      }
      ctx.fill();
    },
  };

  types.ring = {
    update(p, dt) {
      p.life += dt;
      return p.life < p.max;
    },
    draw(ctx, pool) {
      ctx.lineWidth = 0.8;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        const t = p.life / p.max;
        ctx.strokeStyle = `rgba(175,198,226,${0.6 * (1 - t)})`;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 2 + t * 9, 0.8 + t * 2.2, 0, 0, TAU);
        ctx.stroke();
      }
    },
  };

  // ------------------------------------------------------------------ sakura petals and autumn leaves
  function flutterUpdate(cfg) {
    return function (p, dt, e) {
      const sway = Math.sin(e.time * p.freq + p.phase) * p.swayAmp;
      const tvx = e.windX * cfg.wind + sway;
      const tvy = p.vt + Math.cos(e.time * p.freq * 1.7 + p.phase) * p.vt * 0.35;
      p.vx += (tvx - p.vx) * Math.min(1, dt * 1.3);
      p.vy += (tvy - p.vy) * Math.min(1, dt * 1.3);
      e.push(p, 130, 6, 60, dt);
      const py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const spin = 0.4 + Math.min(2, Math.hypot(p.vx, p.vy) / 120);
      p.rot += p.vrot * spin * dt;
      p.flip += p.vflip * dt;
      if (p.vy > 0) {
        const hit = e.findHit(p.x, py, p.y, p.near);
        if (hit) {
          const s = hit.surface;
          e.stick(s, {
            kind: cfg.kind, rx: p.x - s.x, si: p.si, size: p.size,
            rot: p.rot, flat: U.rand(0.3, 0.75), life: 0, max: U.rand(cfg.restMin, cfg.restMax),
          }, cfg.maxStuck ? Math.max(4, Math.floor(s.w / cfg.maxStuck)) : 0);
          return false;
        }
      }
      return !offscreen(p, e);
    };
  }

  function flutterDraw(set) {
    return function (ctx, pool, e) {
      const sprites = e.sprites[set];
      const dpr = e.dpr;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        const spr = sprites[p.si % sprites.length];
        const k = p.size / spr.w;
        const f = Math.cos(p.flip);
        const sy = k * (Math.abs(f) < 0.12 ? (f < 0 ? -0.12 : 0.12) : f);
        const c = Math.cos(p.rot);
        const s = Math.sin(p.rot);
        ctx.globalAlpha = p.alpha === undefined ? 1 : p.alpha;
        ctx.setTransform(dpr * c * k, dpr * s * k, -dpr * s * sy, dpr * c * sy, dpr * p.x, dpr * p.y);
        ctx.drawImage(spr.c, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
    };
  }

  function flutterDrawStuck(set) {
    return function (ctx, s, it, e) {
      const spr = e.sprites[set][it.si % e.sprites[set].length];
      const x = s.x + it.rx;
      const y = s.topAt(x) - it.size * it.flat * 0.35;
      const k = it.size / spr.w;
      const sy = k * it.flat;
      const c = Math.cos(it.rot);
      const sn = Math.sin(it.rot);
      const dpr = e.dpr;
      const fade = U.clamp((it.max - it.life) / 3, 0, 1);
      ctx.globalAlpha = fade;
      ctx.setTransform(dpr * c * k, dpr * sn * k * 0.4, -dpr * sn * sy, dpr * c * sy, dpr * x, dpr * y);
      ctx.drawImage(spr.c, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
    };
  }

  function flutterRelease(kind) {
    return function (e, s, it, vx, vy) {
      const x = s.x + it.rx;
      const p = makeFlutter(e, kind, false);
      p.x = x;
      p.y = s.topAt(x) - 3;
      p.vx = vx + U.rand(-30, 30);
      p.vy = vy + U.rand(-50, 0);
      p.si = it.si;
      p.size = it.size;
      p.rot = it.rot;
    };
  }

  const PETAL = { kind: 'petal', wind: 70, restMin: 25, restMax: 55, maxStuck: 12 };
  const HEART = { kind: 'heart', wind: 55, restMin: 25, restMax: 50, maxStuck: 14 };
  const LEAF = { kind: 'leaf', wind: 80, restMin: 40, restMax: 90, maxStuck: 20 };

  function makeFlutter(e, kind, initial) {
    const leafy = kind === 'leaf';
    const hearty = kind === 'heart';
    const size = (leafy ? U.rand(17, 27) : hearty ? U.rand(11, 17) : U.rand(10, 15)) * e.settings.size;
    const vt = leafy ? U.rand(40, 72) : U.rand(26, 48);
    const wind = leafy ? LEAF.wind : hearty ? HEART.wind : PETAL.wind;
    const drift = e.windX * wind * ((e.H * 0.5) / vt);
    return e.add(kind, {
      x: spawnX(e, drift),
      y: initial ? U.rand(-20, e.H * 0.95) : U.rand(-40, -15),
      vx: 0,
      vy: vt,
      vt,
      size,
      swayAmp: leafy ? U.rand(30, 65) : U.rand(18, 45),
      freq: U.rand(0.5, 1.2),
      phase: U.rand(0, TAU),
      rot: hearty ? U.rand(-0.3, 0.3) : U.rand(0, TAU),
      vrot: U.rand(-2.6, 2.6) * (leafy ? 1.4 : 1),
      flip: U.rand(0, TAU),
      vflip: U.rand(1.5, 4.5) * (hearty ? 0.45 : 1) * (Math.random() < 0.5 ? -1 : 1),
      si: (Math.random() * 64) | 0,
      near: Math.random() < 0.3,
    });
  }

  types.petal = {
    update: flutterUpdate(PETAL),
    draw: flutterDraw('petals'),
    drawStuck: flutterDrawStuck('petals'),
    release: flutterRelease('petal'),
  };
  // Hearts (the letters' sky) flutter like petals but stay upright, rocking gently instead of spinning.
  const heartFlutter = flutterUpdate(HEART);
  types.heart = {
    update(p, dt, e) {
      const alive = heartFlutter(p, dt, e);
      p.rot = Math.sin(e.time * p.freq * 1.3 + p.phase) * 0.35;
      return alive;
    },
    draw: flutterDraw('hearts'),
    drawStuck: flutterDrawStuck('hearts'),
    release: flutterRelease('heart'),
  };
  types.leaf = {
    update: flutterUpdate(LEAF),
    draw: flutterDraw('leaves'),
    drawStuck: flutterDrawStuck('leaves'),
    release: flutterRelease('leaf'),
  };

  // ------------------------------------------------------------------ fireflies
  types.fly = {
    update(p, dt, e) {
      const c = e.cursor;
      p.age += dt;
      if (p.leaving) {
        p.leaving += dt / 2;
        if (p.leaving >= 1) return false;
      }
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      const dist = Math.hypot(dx, dy);
      const gather = e.settings.interactive && c.on && c.still > 0.9 && dist < 900;
      p.join = gather ? Math.min(1, p.join + dt * 0.5) : Math.max(0, p.join - dt * 1.2);
      if (e.settings.interactive && c.on && c.speed > 500 && dist < 170) {
        // A quick flick of the pointer scatters them.
        p.vx -= (dx / (dist || 1)) * 420 * dt * 4;
        p.vy -= (dy / (dist || 1)) * 420 * dt * 4;
        p.rest = null;
        p.join = 0;
      }

      if (p.rest) {
        const s = p.rest.s;
        if (s.missingSince || !e.active.includes(s) || p.age > p.rest.until || p.join > 0.2) {
          p.rest = null;
          p.vy = -30;
        } else {
          p.x = s.x + p.rest.rx;
          p.y = s.topAt(p.x) - 2.5;
          p.vx = 0;
          p.vy = 0;
          p.phase += dt / (p.period * 1.6);
          return true;
        }
      }

      p.heading += e.noise(e.time * 0.35 + p.seed) * dt * 2.6;
      let tvx = Math.cos(p.heading) * p.speed;
      let tvy = Math.sin(p.heading) * p.speed * 0.7;
      // Stay on screen, away from the very top.
      const m = 40;
      if (p.x < m) tvx += (m - p.x) * 2;
      if (p.x > e.W - m) tvx -= (p.x - (e.W - m)) * 2;
      if (p.y < e.H * 0.12) tvy += (e.H * 0.12 - p.y) * 1.5;
      if (p.y > e.H - m) tvy -= (p.y - (e.H - m)) * 2;

      if (p.seek) {
        const s = p.seek.s;
        if (s.missingSince || !e.active.includes(s)) {
          p.seek = null;
        } else {
          const tx = s.x + p.seek.rx;
          const ty = s.topAt(tx) - 2.5;
          const sx = tx - p.x;
          const sy = ty - p.y;
          const sd = Math.hypot(sx, sy);
          if (sd < 5) {
            p.rest = { s, rx: p.seek.rx, until: p.age + U.rand(4, 10) };
            p.seek = null;
          } else {
            tvx = (sx / sd) * Math.min(70, sd * 2);
            tvy = (sy / sd) * Math.min(70, sd * 2);
          }
        }
      } else if (!p.join && Math.random() < dt * 0.03 && e.active.length > 1) {
        const s = e.active[1 + ((Math.random() * (e.active.length - 1)) | 0)];
        const iv = s.intervals[(Math.random() * s.intervals.length) | 0];
        if (iv && Math.abs(s.y - p.y) < 500) p.seek = { s, rx: U.rand(iv[0] + 6, iv[1] - 6) - s.x };
      }

      if (p.join > 0) {
        p.orbitA += p.orbitW * dt;
        const tx = c.x + Math.cos(p.orbitA) * p.orbitR;
        const ty = c.y + Math.sin(p.orbitA) * p.orbitR * 0.7;
        const gx = tx - p.x;
        const gy = ty - p.y;
        const gd = Math.hypot(gx, gy) || 1;
        const sp = Math.min(150, gd * 1.6);
        tvx = U.lerp(tvx, (gx / gd) * sp, p.join);
        tvy = U.lerp(tvy, (gy / gd) * sp, p.join);
        p.seek = null;
      }

      p.vx += (tvx - p.vx) * Math.min(1, dt * 2.2);
      p.vy += (tvy - p.vy) * Math.min(1, dt * 2.2);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.phase += dt / p.period;
      return true;
    },
    draw(ctx, pool, e) {
      const spr = e.sprites.firefly;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        const f = p.phase % 1;
        // A soft flash, then a long dim glow; fireflies near the pointer stay brighter.
        let b = f < 0.32 ? Math.sin((f / 0.32) * Math.PI) : 0;
        b = Math.max(b, 0.12 + p.join * 0.5);
        if (p.rest) b *= 0.75;
        const fade = Math.min(1, p.age / 2) * (p.leaving ? Math.max(0, 1 - p.leaving) : 1);
        const a = b * fade;
        if (a < 0.02) continue;
        ctx.globalAlpha = a;
        drawSpriteAt(ctx, spr, p.x, p.y, 0.7 + b * 0.6);
        ctx.globalAlpha = Math.min(1, a * 1.4);
        ctx.fillStyle = 'rgba(255,255,215,1)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.3, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = fade * 0.55;
        ctx.fillStyle = 'rgba(60,52,25,1)';
        ctx.beginPath();
        ctx.arc(p.x - Math.cos(p.heading) * 1.6, p.y - Math.sin(p.heading) * 1.6, 1.1, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };

  function spawnFly(e) {
    return e.add('fly', {
      x: U.rand(40, e.W - 40),
      y: U.rand(e.H * 0.2, e.H - 50),
      vx: 0, vy: 0,
      heading: U.rand(0, TAU),
      speed: U.rand(14, 36),
      seed: U.rand(0, 400),
      phase: Math.random(),
      period: U.rand(2.2, 5.5),
      orbitA: U.rand(0, TAU),
      orbitR: U.rand(22, 95),
      orbitW: U.rand(0.4, 1.1) * (Math.random() < 0.5 ? -1 : 1),
      join: 0, age: 0, rest: null, seek: null, leaving: 0,
    });
  }

  // ------------------------------------------------------------------ starfall
  types.meteor = {
    update(p, dt, e) {
      p.trail.push(p.x, p.y);
      if (p.trail.length > 28) p.trail.splice(0, 2);
      const py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.dist += Math.hypot(p.vx, p.vy) * dt;
      const c = e.cursor;
      if (e.settings.interactive && c.on && Math.hypot(p.x - c.x, p.y - c.y) < 36) {
        burst(e, p.x, p.y, 16, p.blue, 260);
        return false;
      }
      const hit = e.findHit(p.x, py, p.y);
      if (hit) {
        burst(e, p.x, hit.top - 1, 26, p.blue, 300, true);
        return false;
      }
      if (p.dist > p.maxDist) {
        burst(e, p.x, p.y, 9, p.blue, 160);
        return false;
      }
      return !offscreen(p, e);
    },
    draw(ctx, pool, e) {
      ctx.lineCap = 'round';
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        const t = p.trail;
        if (t.length >= 4) {
          const g = ctx.createLinearGradient(t[0], t[1], p.x, p.y);
          g.addColorStop(0, p.blue ? 'rgba(170,200,255,0)' : 'rgba(255,220,160,0)');
          g.addColorStop(1, p.blue ? 'rgba(225,235,255,0.95)' : 'rgba(255,245,220,0.95)');
          ctx.strokeStyle = g;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(t[0], t[1]);
          for (let k = 2; k < t.length; k += 2) ctx.lineTo(t[k], t[k + 1]);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          // thin dark edge so the streak still reads over white windows
          ctx.strokeStyle = 'rgba(40,50,80,0.12)';
          ctx.lineWidth = 3.6;
          ctx.stroke();
        }
        drawSpriteAt(ctx, p.blue ? e.sprites.blueSpark : e.sprites.spark, p.x, p.y, 1.5);
      }
    },
  };

  function spawnMeteor(e) {
    const dir = Math.random() < 0.5 + e.settings.wind * 0.35 ? 1 : -1;
    const ang = U.rand(0.3, 0.7);
    const sp = U.rand(650, 1050);
    return e.add('meteor', {
      x: dir > 0 ? U.rand(-0.1, 0.75) * e.W : U.rand(0.25, 1.1) * e.W,
      y: U.rand(-40, e.H * 0.35),
      vx: Math.cos(ang) * sp * dir,
      vy: Math.sin(ang) * sp,
      dist: 0,
      maxDist: U.rand(260, 950),
      trail: [],
      blue: Math.random() < 0.45,
    });
  }

  function burst(e, x, y, n, blue, power, ground) {
    for (let k = 0; k < n; k++) {
      const a = ground ? U.rand(Math.PI * 1.05, Math.PI * 1.95) : U.rand(0, TAU);
      const s = U.rand(0.25, 1) * power;
      e.add('spark', {
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0, max: U.rand(0.6, 1.5), r: U.rand(0.5, 1.1), blue: blue && Math.random() < 0.7,
      });
    }
  }

  types.spark = {
    update(p, dt, e) {
      p.life += dt;
      p.vy += 520 * dt;
      p.vx *= Math.exp(-dt * 0.9);
      e.push(p, 90, 2, 260, dt);
      const py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.vy > 0) {
        const hit = e.findHit(p.x, py, p.y);
        if (hit) {
          if (p.vy > 90) {
            p.y = hit.top - 0.5;
            p.vy *= -0.35;
            p.vx *= 0.7;
          } else {
            e.stick(hit.surface, {
              kind: 'ember', rx: p.x - hit.surface.x, blue: p.blue, r: p.r,
              life: 0, max: U.rand(0.8, 2.4),
            }, 0);
            return false;
          }
        }
      }
      return p.life < p.max && !offscreen(p, e);
    },
    draw(ctx, pool, e) {
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
        drawSpriteAt(ctx, p.blue ? e.sprites.blueSpark : e.sprites.spark, p.x, p.y, p.r);
      }
      ctx.globalAlpha = 1;
    },
  };

  types.ember = {
    update: () => false,
    draw() {},
    drawStuck(ctx, s, it, e) {
      const x = s.x + it.rx;
      const y = s.topAt(x) - 1;
      ctx.globalAlpha = Math.max(0, 1 - it.life / it.max) * (0.7 + 0.3 * Math.sin(it.life * 20));
      drawSpriteAt(ctx, it.blue ? e.sprites.blueSpark : e.sprites.spark, x, y, it.r * 0.9);
      ctx.globalAlpha = 1;
    },
    release() {},
  };

  // ------------------------------------------------------------------ Santa's glitter and the gift's confetti
  types.glitter = {
    update(p, dt) {
      p.life += dt;
      p.vy += 40 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      return p.life < p.max;
    },
    draw(ctx, pool, e) {
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        const t = p.life / p.max;
        ctx.globalAlpha = (1 - t) * (0.6 + 0.4 * Math.sin(p.life * 25 + i));
        drawSpriteAt(ctx, e.sprites.spark, p.x, p.y, p.r);
      }
      ctx.globalAlpha = 1;
    },
  };

  const CONFETTI = ['#f25f5c', '#ffe066', '#70c1b3', '#4f9dde', '#ff9ff3', '#ffffff', '#f7a072'];
  types.confetti = {
    update(p, dt) {
      p.life += dt;
      p.vy += 380 * dt;
      p.vx *= Math.exp(-dt * 1.8);
      p.vy *= Math.exp(-dt * 1.2);
      p.x += p.vx * dt + Math.sin(p.life * 6 + p.phase) * 20 * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      p.flip += dt * 9;
      return p.life < p.max;
    },
    draw(ctx, pool, e) {
      const dpr = e.dpr;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        const c = Math.cos(p.rot);
        const s = Math.sin(p.rot);
        const f = Math.cos(p.flip);
        ctx.globalAlpha = U.clamp((p.max - p.life) / 0.6, 0, 1);
        ctx.setTransform(dpr * c, dpr * s, -dpr * s * f, dpr * c * f, dpr * p.x, dpr * p.y);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
    },
  };

  Drift.fx = {
    burst,
    confetti(e, x, y, n) {
      for (let k = 0; k < n; k++) {
        const a = U.rand(-Math.PI * 0.9, -Math.PI * 0.1);
        const s = U.rand(180, 520);
        e.add('confetti', {
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          rot: U.rand(0, TAU), vrot: U.rand(-9, 9), flip: U.rand(0, TAU), phase: U.rand(0, TAU),
          w: U.rand(4, 7), h: U.rand(2.5, 4), color: U.pick(CONFETTI), life: 0, max: U.rand(2.2, 3.4),
        });
      }
    },
    glitter(e, x, y) {
      e.add('glitter', {
        x: x + U.rand(-4, 4), y: y + U.rand(-4, 4), vx: U.rand(-15, 15), vy: U.rand(-5, 25),
        life: 0, max: U.rand(0.6, 1.3), r: U.rand(0.4, 0.9),
      });
    },
  };

  // ------------------------------------------------------------------ the weathers
  // rate(): particles per second per 1000 px of screen width. max(): cap on live particles.
  const I = (e) => e.settings.intensity;
  Drift.effects = {
    snow: {
      type: 'flake',
      rate: (e) => U.lerp(5, 62, I(e)),
      max: () => 1800,
      spawn: spawnFlake,
      prefill(e) {
        const n = Math.round(U.lerp(5, 62, I(e)) * (e.W / 1000) * (e.H / 55) * 0.85 * (e.low ? 0.5 : 1));
        for (let k = e.count('flake'); k < Math.min(n, 1400); k++) spawnFlake(e, true);
      },
    },
    rain: {
      type: 'drop',
      rate: (e) => U.lerp(40, 430, I(e)),
      max: () => 900,
      spawn: spawnDrop,
      prefill(e) {
        const n = Math.round(U.lerp(40, 430, I(e)) * (e.W / 1000) * (e.H / 1050) * (e.low ? 0.5 : 1));
        for (let k = e.count('drop'); k < Math.min(n, 700); k++) spawnDrop(e, true);
      },
    },
    sakura: {
      type: 'petal',
      rate: (e) => U.lerp(0.8, 9, I(e)),
      max: () => 360,
      spawn: (e, initial) => makeFlutter(e, 'petal', initial),
      prefill(e) {
        const n = Math.round(U.lerp(0.8, 9, I(e)) * (e.W / 1000) * (e.H / 40) * 0.7 * (e.low ? 0.5 : 1));
        for (let k = e.count('petal'); k < Math.min(n, 300); k++) makeFlutter(e, 'petal', true);
      },
    },
    // Not in the weather menu: the letters' sky (src/renderer/overlay/letters.js), and the test page.
    hearts: {
      type: 'heart',
      rate: (e) => U.lerp(0.8, 6, I(e)),
      max: () => 260,
      spawn: (e, initial) => makeFlutter(e, 'heart', initial),
      prefill(e) {
        const n = Math.round(U.lerp(0.8, 6, I(e)) * (e.W / 1000) * (e.H / 40) * 0.7 * (e.low ? 0.5 : 1));
        for (let k = e.count('heart'); k < Math.min(n, 220); k++) makeFlutter(e, 'heart', true);
      },
    },
    leaves: {
      type: 'leaf',
      rate: (e) => U.lerp(0.4, 5, I(e)),
      max: () => 160,
      spawn: (e, initial) => makeFlutter(e, 'leaf', initial),
      prefill(e) {
        const n = Math.round(U.lerp(0.4, 5, I(e)) * (e.W / 1000) * (e.H / 56) * 0.7 * (e.low ? 0.5 : 1));
        for (let k = e.count('leaf'); k < Math.min(n, 140); k++) makeFlutter(e, 'leaf', true);
      },
    },
    fireflies: {
      type: 'fly',
      rate: () => 0,
      max: () => 0,
      spawn: () => null,
      // Keep a steady population sized to the screen; extras fade out rather than vanish.
      tick(e, dt) {
        const want = Math.round(((e.W * e.H) / (1440 * 900)) * U.lerp(10, 48, I(e)) * (e.low ? 0.5 : 1));
        const pool = e.pools.fly || [];
        const alive = pool.filter((p) => !p.leaving).length;
        if (alive < want && Math.random() < dt * 4) spawnFly(e);
        if (alive > want) {
          const p = pool.find((q) => !q.leaving);
          if (p) p.leaving = 0.0001;
        }
      },
      prefill(e) {
        const want = Math.round(((e.W * e.H) / (1440 * 900)) * U.lerp(10, 48, I(e)) * (e.low ? 0.5 : 1));
        const alive = (e.pools.fly || []).filter((p) => !p.leaving).length;
        for (let k = alive; k < want; k++) spawnFly(e).age = U.rand(0, 2);
      },
    },
    starfall: {
      type: 'meteor',
      rate: (e) => U.lerp(0.15, 2.2, I(e)),
      max: () => 14,
      spawn: spawnMeteor,
    },
    off: null,
  };

  // Fireflies that are no longer wanted (the weather changed) fade out instead of popping.
  Drift.retireFireflies = function (e) {
    for (const p of e.pools.fly || []) if (!p.leaving) p.leaving = 0.0001;
  };
})();

/* src/renderer/overlay/extras.js */
/* Santa's flyby, the daily gift you open by hovering over it, and the snowmen in the ground snow. */
(function () {
  'use strict';
  const Drift = window.Drift;
  const U = Drift.util;
  const TAU = Math.PI * 2;

  const MESSAGES = [
    'A warm cup of cocoa is waiting for you somewhere.',
    'You are doing better than you think.',
    'Today\'s gift: permission to take a real break.',
    'Snow day energy, unlocked.',
    'Somebody out there is very glad you exist.',
    'Stand up and stretch. Your shoulders say thank you.',
    'A tiny reminder to drink some water.',
    'May your coffee be strong and your meetings short.',
    'This box contains one fresh start. Use it well.',
    'Look out of a window for ten seconds. Nice, right?',
    'Send a kind message to someone today.',
    'Every snowflake is different, and so are you.',
    'You found it! There is another one tomorrow.',
    'Breathe in for four, out for six. Again.',
    'Good things are on their way.',
    'Your to-do list can wait one minute. Smile.',
    'The best is yet to snow.',
    'Fun fact: no two days are alike either.',
    'You have survived every hard day so far.',
    'Treat yourself to something sweet later.',
  ];

  const SNOWMAN_SPOTS = [0.13, 0.87, 0.34];
  // Advent boxes: [light side, dark side, lid, ribbon]
  const ADVENT_COLORS = [
    ['#e2544a', '#b8322c', '#c93b33', '#f6c945'],
    ['#3fae6a', '#21794a', '#2c8f58', '#f6d365'],
    ['#4f8fe0', '#2a5fae', '#3a74c8', '#ffffff'],
    ['#f5c84c', '#cf9a1e', '#e0ad2c', '#c8283a'],
  ];

  class Extras {
    constructor(engine) {
      this.e = engine;
      this.santa = null;
      this.gift = null;      // the box sitting (or falling) on this display
      this.giftDay = null;
      this.message = null;
      this.openedDays = new Set();
      this.visitor = null;   // Santa's big visit on Christmas Eve (presents under the tree)
    }

    // A note above something (the same card as the gift's message): a present's contents, Santa's greeting.
    showNote(title, text, x, y, max) {
      const e = this.e;
      this.message = { text, title, lang: (e.strings && e.strings.lang) || 'en', x, y, life: 0, max: max || 9 };
    }

    // Christmas Eve at sunset: Santa flies in slowly, stops above the tree, leaves three presents under it,
    // has the milk and cookies, says hello and flies off. Without Santa (switched off), the presents simply
    // drop from the sky.
    christmasVisit(withSanta) {
      const e = this.e;
      const f = e.festive;
      if (!f) return;
      f.beginVisit();
      const k = U.clamp(e.settings.size, 0.8, 1.25) * 1.1;
      if (!withSanta) {
        this.visitor = { sky: true, t: 0, k, dropped: 0 };
        return;
      }
      const hx = f.treeX() + 30 * k;
      const ground = f.top(hx);
      const hy = U.clamp(ground - 165 * k, e.H * 0.2, e.H - 120);
      this.visitor = {
        t: 0, ht: 0, ot: 0, phase: 'in', k, dir: 1, tilt: 0,
        x0: -420 * k, y0: e.H * 0.1, x: -420 * k, y: e.H * 0.1, hx, hy,
        dropped: 0, said: false, ate: false,
      };
    }

    updateVisitor(dt) {
      const v = this.visitor;
      const e = this.e;
      const f = e.festive;
      if (!v || !f) return;
      v.t += dt;
      const ids = ['letter', 'icon', 'wish'];
      if (v.sky) {
        // one present after another, falling from above the tree
        if (v.dropped < ids.length && v.t > 0.6 + v.dropped * 0.9) {
          const id = ids[v.dropped++];
          const at = f.presentSpot(id);
          f.dropPresent(id, at.x, -30, 0);
        }
        if (v.t > 5) {
          this.visitor = null;
          f.endVisit();
        }
        return;
      }
      const px = v.x;
      const py = v.y;
      if (v.phase === 'in') {
        const p = U.clamp(v.t / 7, 0, 1);
        const s = 1 - Math.pow(1 - p, 3);
        v.x = U.lerp(v.x0, v.hx, s);
        v.y = U.lerp(v.y0, v.hy, U.smooth(p)) + Math.sin(v.t * 1.7) * 5 * v.k * (1 - p);
        if (p >= 1) v.phase = 'hover';
      } else if (v.phase === 'hover') {
        v.ht += dt;
        v.x = v.hx + Math.sin(v.ht * 0.8) * 6 * v.k;
        v.y = v.hy + Math.sin(v.ht * 2) * 4 * v.k;
        // the presents, from the sack, each landing in its place under the tree
        if (v.dropped < ids.length && v.ht > 0.6 + v.dropped * 1.0) {
          const id = ids[v.dropped++];
          const sx = v.x - 22 * v.k;
          const sy = v.y - 8 * v.k;
          const at = f.presentSpot(id);
          const fall = Math.max(20, at.y - sy);
          const time = (20 + Math.sqrt(400 + 2 * 520 * fall)) / 520;
          f.dropPresent(id, sx, sy, (at.x - sx) / time);
        }
        if (!v.said && v.ht > 1.2) {
          v.said = true;
          const str = (e.strings && e.strings.fest && e.strings.fest.christmas) || {};
          this.showNote(str.santaTitle || 'Santa Claus', str.hoHoHo || 'Ho ho ho! Merry Christmas!', v.x + 60 * v.k, v.y - 40 * v.k, 6);
        }
        if (!v.ate && v.ht > 3.6) {
          v.ate = true;
          f.munch();
        }
        if (v.ht > 5) v.phase = 'out';
      } else {
        v.ot += dt;
        v.x += (70 + v.ot * 300) * dt;
        v.y -= (30 + v.ot * 110) * dt;
        if (v.x > e.W + 420 * v.k || v.y < -260) {
          this.visitor = null;
          f.endVisit();
          return;
        }
      }
      const vy = (v.y - py) / Math.max(dt, 1e-3);
      const vx = Math.max(40, (v.x - px) / Math.max(dt, 1e-3));
      v.tilt += (U.clamp(Math.atan2(vy, vx), -0.22, 0.22) - v.tilt) * Math.min(1, dt * 3);
      if (Math.random() < dt * 30) Drift.fx.glitter(e, v.x - 40 * v.k, v.y + 8 * v.k);
    }

    // Gift state from the app: show it if it belongs to this display and is not opened yet.
    setGift(g) {
      const e = this.e;
      if (!g || g.opened || String(g.displayId) !== String(e.display.id) || this.openedDays.has(g.day)) {
        if (!this.gift || (!this.gift.falling && !(this.gift.opening > 0))) {
          this.gift = null;
          this.giftDay = null;
        }
        return;
      }
      if (this.gift && this.giftDay === g.day) return;
      this.giftDay = g.day;
      this.gift = this.makeGift(g.xFrac * e.W, null, g.advent);
    }

    // advent: the day's number on an Advent calendar box (0 for an ordinary gift).
    makeGift(x, y, advent) {
      const e = this.e;
      const k = U.clamp(e.settings.size, 0.8, 1.3) * (advent ? 1.08 : 1);
      return {
        x: U.clamp(x, 40, e.W - 40), y: y === null ? this.groundTop(x) : y,
        vx: 0, vy: 0, falling: y !== null, w: 26 * k, h: 22 * k,
        hover: 0, opening: 0, t: Math.random() * 10, advent: advent || 0,
      };
    }

    // Without Santa (switched off), the Advent box drops from the sky by itself.
    dropGift(g) {
      const e = this.e;
      if (!g || String(g.displayId) !== String(e.display.id)) return;
      this.giftDay = g.day;
      this.gift = this.makeGift(g.xFrac * e.W, -40, g.advent);
      this.gift.vy = 60;
    }

    groundTop(x) {
      const g = this.e.ground;
      return g.y - (g.maxH > 0 ? g.heightAt(x) : 0);
    }

    // Every visit takes a slightly different route: either direction, a different height,
    // a gentle climb or descent and a soft swoop in the middle.
    callSanta(gift) {
      const e = this.e;
      const k = U.clamp(e.settings.size, 0.8, 1.25);
      const dir = Math.random() < 0.5 ? 1 : -1;
      const y0 = e.H * U.rand(0.08, 0.28);
      const y1 = U.clamp(y0 + e.H * U.rand(-0.14, 0.14), e.H * 0.06, e.H * 0.34);
      const margin = 340 * k;
      this.santa = {
        dir, k, t: 0,
        x0: dir > 0 ? -margin : e.W + margin,
        x1: dir > 0 ? e.W + margin : -margin,
        x: dir > 0 ? -margin : e.W + margin,
        y: y0, y0, y1,
        swoop: e.H * U.rand(-0.07, 0.07),
        bobAmp: U.rand(5, 12) * k,
        bobFreq: U.rand(1.3, 2.2),
        speed: U.rand(170, 250),
        tilt: 0,
        gift: gift && String(gift.displayId) === String(e.display.id) ? gift : null,
        dropped: false,
        // on la Befana's days, her broom instead of Santa's sleigh (src/renderer/overlay/january.js)
        befana: !!(e.festive && e.festive.january && e.festive.january.befanaDay() && Drift.drawBefana),
      };
      if (this.santa.befana) {
        this.santa.speed *= 0.8;
        this.santa.k *= 1.15;
      }
    }

    update(dt) {
      const e = this.e;
      const s = this.santa;
      if (s) {
        s.t += dt;
        s.x += s.speed * s.dir * dt;
        const p = U.clamp((s.x - s.x0) / (s.x1 - s.x0), 0, 1);
        const prevY = s.y;
        s.y = U.lerp(s.y0, s.y1, U.smooth(p)) + Math.sin(Math.PI * p) * s.swoop
          + Math.sin(s.t * s.bobFreq) * s.bobAmp;
        // lean gently into climbs and dives
        const vy = (s.y - prevY) / Math.max(dt, 1e-3);
        s.tilt += (U.clamp(Math.atan2(vy, s.speed), -0.25, 0.25) - s.tilt) * Math.min(1, dt * 4);
        if (Math.random() < dt * 40) Drift.fx.glitter(e, s.x - 40 * s.k * s.dir, s.y + 8 * s.k);
        const gx = s.gift ? s.gift.xFrac * e.W : 0;
        if (s.gift && !s.dropped && (s.dir > 0 ? s.x >= gx : s.x <= gx)) {
          s.dropped = true;
          this.giftDay = s.gift.day;
          this.gift = this.makeGift(s.x, s.y + 10 * s.k, s.gift.advent);
          this.gift.vx = s.speed * 0.35 * s.dir;
          this.gift.vy = -40;
        }
        if (p >= 1) this.santa = null;
      }

      const g = this.gift;
      if (g) {
        g.t += dt;
        if (g.falling) {
          g.vy += 520 * dt;
          g.vx *= Math.exp(-dt * 0.8);
          g.x = U.clamp(g.x + g.vx * dt, 40, e.W - 40);
          g.y += g.vy * dt;
          const top = this.groundTop(g.x);
          if (g.y >= top) {
            g.y = top;
            if (g.vy > 140) {
              g.vy *= -0.3;
              Drift.fx.burst(e, g.x, top - 2, 6, false, 80, true);
            } else {
              g.falling = false;
              g.vy = 0;
            }
          }
        } else {
          g.y = this.groundTop(g.x);
        }
        if (g.opening > 0) {
          g.opening += dt;
          if (g.opening > 0.5) this.gift = null;
        } else {
          const c = e.cursor;
          const over = c.on && Math.abs(c.x - g.x) < g.w / 2 + 8 && c.y > g.y - g.h - 14 && c.y < g.y + 6;
          g.hover = over ? g.hover + dt : Math.max(0, g.hover - dt * 2);
          if (g.hover > 1.0 && !g.falling) this.openGift();
        }
      }

      this.updateVisitor(dt);
      if (this.message) {
        this.message.life += dt;
        if (this.message.life > this.message.max) this.message = null;
      }
      this.updateNote();
    }

    // The gift's message is real text in the page, so it stays sharp at any screen density.
    updateNote() {
      const m = this.message;
      if (!m) {
        if (this.note) this.note.style.opacity = '0';
        return;
      }
      if (!this.note) this.note = createNote();
      const n = this.note;
      if (n.dataset.text !== m.text) {
        n.dataset.text = m.text;
        n.lang = m.lang;
        n.querySelector('.drift-note-text').textContent = m.text;
        n.querySelector('.drift-note-title span').textContent = m.title;
      }
      const e = this.e;
      const t = m.life;
      const a = Math.min(1, t / 0.35) * Math.min(1, (m.max - t) / 0.9);
      const w = n.offsetWidth || 300;
      const h = n.offsetHeight || 90;
      const x = U.clamp(m.x - w / 2, 14, e.W - w - 14);
      const y = Math.max(14, m.y - h - 16);
      const rise = (1 - Math.min(1, t / 0.35)) * 10;
      n.style.transform = `translate(${Math.round(x)}px, ${Math.round(y + rise)}px)`;
      n.style.opacity = String(Math.max(0, a));
      n.style.setProperty('--arrow-x', `${Math.round(U.clamp(m.x - x, 22, w - 22))}px`);
    }

    openGift() {
      const e = this.e;
      const g = this.gift;
      g.opening = 0.0001;
      this.openedDays.add(this.giftDay);
      Drift.fx.confetti(e, g.x, g.y - g.h, 80);
      Drift.fx.burst(e, g.x, g.y - g.h, 18, false, 220);
      const str = e.strings && e.strings.gift;
      const list = str && Array.isArray(str.messages) && str.messages.length ? str.messages : MESSAGES;
      let text = U.pick(list);
      let title = (str && str.title) || 'A gift from Santa';
      // An Advent box: what it adds to the desktop.
      const adv = g.advent && e.strings && e.strings.fest && e.strings.fest.advent;
      if (adv && Array.isArray(adv.days) && adv.days[g.advent - 1]) {
        text = adv.days[g.advent - 1];
        title = String(adv.box || 'Advent calendar · {day}').replace('{day}', g.advent);
      }
      this.message = {
        text, title, lang: (e.strings && e.strings.lang) || 'en',
        x: g.x, y: g.y - g.h - 10, life: 0, max: g.advent ? 11 : 9,
      };
      e.host.send('overlay:gift-opened', { day: this.giftDay });
    }

    // ---------------------------------------------------------------- drawing
    drawBack(ctx) {
      const e = this.e;
      const st = e.settings;
      if (st.effect === 'snow' && st.pileUp && st.snowmen > 0 && e.ground.maxH >= 20) {
        // keep clear of the Advent tree and its friends at the left
        const clear = e.festive ? e.festive.groundRight() : 0;
        const hats = !!(e.festive && e.festive.hats);
        for (let i = 0; i < Math.min(3, st.snowmen); i++) {
          let x = SNOWMAN_SPOTS[i] * e.W;
          if (clear && x < clear + 34) x = clear + 34 + i * 60;
          const depth = e.ground.heightAt(x);
          const a = U.clamp((depth - 6) / 10, 0, 1);
          if (a > 0) drawSnowman(ctx, x, e.ground.y - depth + 5, U.clamp(st.size, 0.8, 1.3), a, i, hats);
        }
      }
      if (this.gift) this.drawGift(ctx, this.gift);
    }

    drawFront(ctx) {
      if (this.santa) (this.santa.befana ? Drift.drawBefana : drawSanta)(ctx, this.santa, this.e);
      const v = this.visitor;
      if (v && !v.sky) drawSanta(ctx, v, this.e);
    }

    drawGift(ctx, g) {
      const lift = g.opening > 0 ? g.opening / 0.5 : 0;
      const wob = g.hover > 0 ? Math.sin(g.t * 28) * 0.09 * Math.min(1, g.hover * 1.5) : 0;
      const idle = g.falling ? g.t * 3 : Math.sin(g.t * 2.2) * 0.02;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(wob + (g.falling ? Math.sin(idle) * 0.2 : idle));
      ctx.globalAlpha = 1 - lift;
      const w = g.w;
      const h = g.h;
      // shadow
      ctx.fillStyle = 'rgba(30,40,60,0.18)';
      ctx.beginPath();
      ctx.ellipse(0, 1, w * 0.62, 3, 0, 0, TAU);
      ctx.fill();
      // box (Advent boxes take turns in red, green, blue and gold)
      const pal = g.advent ? ADVENT_COLORS[(g.advent - 1) % ADVENT_COLORS.length] : ['#e2544a', '#b8322c', '#c93b33', '#f6c945'];
      const body = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      body.addColorStop(0, pal[0]);
      body.addColorStop(1, pal[1]);
      ctx.fillStyle = body;
      roundRect(ctx, -w / 2, -h, w, h, 2.5);
      ctx.fill();
      ctx.fillStyle = pal[3];
      ctx.fillRect(-2.2, -h, 4.4, h);
      if (g.advent) {
        // the day's number on a round tag
        ctx.fillStyle = '#fffaf0';
        ctx.beginPath();
        ctx.arc(-w * 0.24, -h * 0.45, 6.4, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = pal[3];
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = pal[1];
        ctx.font = '700 8.5px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(g.advent), -w * 0.24, -h * 0.45 + 0.5);
      }
      // lid (lifts off while opening)
      ctx.save();
      ctx.translate(0, -h - lift * 26);
      ctx.rotate(-lift * 0.6);
      ctx.fillStyle = pal[2];
      roundRect(ctx, -w / 2 - 2, -6, w + 4, 7, 2);
      ctx.fill();
      ctx.fillStyle = pal[3];
      ctx.fillRect(-2.2, -6, 4.4, 7);
      // bow
      ctx.fillStyle = '#ffd95c';
      ctx.strokeStyle = '#d9a72b';
      ctx.lineWidth = 0.8;
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(sgn * 5.5, -9, 5.5, 3.4, sgn * 0.5, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, -8, 2.4, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.restore();
      // An occasional twinkle invites a hover.
      if (!g.opening && !g.falling) {
        const tw = (g.t % 3.2) / 3.2;
        if (tw < 0.18) {
          ctx.globalAlpha = Math.sin((tw / 0.18) * Math.PI);
          const spr = this.e.sprites.spark;
          const s = spr.size * 1.4;
          ctx.drawImage(spr.c, g.x + w * 0.35 - s / 2, g.y - h - 10 - s / 2, s, s);
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  function createNote() {
    const style = document.createElement('style');
    style.textContent = `
      .drift-note {
        position: fixed; left: 0; top: 0; z-index: 22; width: max-content; max-width: 320px;
        padding: 14px 18px 15px; border-radius: 16px; opacity: 0; pointer-events: none;
        background: linear-gradient(180deg, #ffffff, #fbf7f2);
        color: #1d2130; box-shadow: 0 14px 40px rgba(10, 15, 35, 0.35), 0 2px 6px rgba(10, 15, 35, 0.18);
        border: 1px solid rgba(255, 255, 255, 0.9);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        -webkit-font-smoothing: antialiased; will-change: transform, opacity;
      }
      .drift-note::after {
        content: ""; position: absolute; left: calc(var(--arrow-x, 50%) - 9px); bottom: -8px;
        width: 18px; height: 18px; background: #fbf7f2; transform: rotate(45deg); border-radius: 3px;
        box-shadow: 4px 4px 8px rgba(10, 15, 35, 0.12);
      }
      .drift-note-title {
        display: flex; align-items: center; gap: 7px; margin-bottom: 5px;
        font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #c63a33;
      }
      .drift-note-title svg { width: 16px; height: 16px; flex: none; }
      .drift-note-text { font-size: 17px; line-height: 1.38; font-weight: 600; letter-spacing: -0.005em; }
    `;
    document.head.appendChild(style);
    const n = document.createElement('div');
    n.className = 'drift-note';
    n.innerHTML = '<div class="drift-note-title"><svg viewBox="0 0 24 24" aria-hidden="true">'
      + '<rect x="3.5" y="9" width="17" height="11.5" rx="1.6" fill="#d8453c"/>'
      + '<rect x="2.5" y="6.5" width="19" height="4" rx="1.2" fill="#e85a4f"/>'
      + '<rect x="10.6" y="6.5" width="2.8" height="14" fill="#f5c542"/>'
      + '<path d="M12 6.6C10.4 3.2 6.6 3.3 7 5.4c.3 1.5 3 1.3 5 1.2Zm0 0c1.6-3.4 5.4-3.3 5-1.2-.3 1.5-3 1.3-5 1.2Z" fill="#f5c542"/>'
      + '</svg><span>A gift from Santa</span></div><div class="drift-note-text"></div>';
    document.body.appendChild(n);
    return n;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ------------------------------------------------------------------ snowman
  function ball(ctx, x, y, r) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.7, '#f1f5fb');
    g.addColorStop(1, '#d3deec');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(110,130,160,0.4)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  function drawSnowman(ctx, x, base, k, alpha, variant, santaHat) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, base);
    ctx.scale(k, k);
    const r1 = 17;
    const r2 = 12;
    const r3 = 9;
    const y1 = -r1 + 2;
    const y2 = y1 - r1 - r2 + 6;
    const y3 = y2 - r2 - r3 + 4;
    // arms
    ctx.strokeStyle = '#6b4a2f';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r2 + 2, y2);
    ctx.lineTo(-r2 - 13, y2 - 9);
    ctx.moveTo(-r2 - 8, y2 - 6);
    ctx.lineTo(-r2 - 11, y2 - 13);
    ctx.moveTo(r2 - 2, y2);
    ctx.lineTo(r2 + 13, y2 - 11);
    ctx.moveTo(r2 + 9, y2 - 8);
    ctx.lineTo(r2 + 15, y2 - 6);
    ctx.stroke();
    ball(ctx, 0, y1, r1);
    ball(ctx, 0, y2, r2);
    ball(ctx, 0, y3, r3);
    // buttons
    ctx.fillStyle = '#2b2b33';
    for (const by of [y2 - 5, y2 + 1, y2 + 7]) {
      ctx.beginPath();
      ctx.arc(0, by, 1.4, 0, TAU);
      ctx.fill();
    }
    // face
    ctx.beginPath();
    ctx.arc(-3, y3 - 2, 1.2, 0, TAU);
    ctx.arc(3, y3 - 2, 1.2, 0, TAU);
    ctx.fill();
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.arc(i * 1.9, y3 + 3.6 + Math.abs(i) * -0.5, 0.7, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#f08a2c';
    ctx.beginPath();
    ctx.moveTo(0, y3 - 0.6);
    ctx.lineTo(9, y3 + 1);
    ctx.lineTo(0, y3 + 1.6);
    ctx.closePath();
    ctx.fill();
    // scarf
    const scarf = ['#d8433b', '#2f7fd0', '#3aa76d'][variant % 3];
    ctx.fillStyle = scarf;
    roundRect(ctx, -r3 - 1, y3 + r3 - 3, (r3 + 1) * 2, 4.5, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(4, y3 + r3);
    ctx.lineTo(9, y3 + r3 + 11);
    ctx.lineTo(4.5, y3 + r3 + 12);
    ctx.lineTo(1, y3 + r3 + 1);
    ctx.closePath();
    ctx.fill();
    // hat (a Santa hat from the 21st Advent box)
    if (santaHat && Drift.festiveDraw) {
      Drift.festiveDraw.drawSantaHat(ctx, 0.5, y3 - r3 + 2.5, 1.05, -0.12);
    } else if (variant % 2 === 0) {
      ctx.fillStyle = '#23232b';
      ctx.fillRect(-9, y3 - r3 + 1, 18, 2.4);
      ctx.fillRect(-6, y3 - r3 - 10, 12, 11);
      ctx.fillStyle = scarf;
      ctx.fillRect(-6, y3 - r3 - 2.5, 12, 2);
    } else {
      ctx.fillStyle = scarf;
      ctx.beginPath();
      ctx.arc(0, y3 - r3 + 3, 8, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, y3 - r3 - 5, 3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ Santa, his sleigh and four reindeer
  function drawReindeer(ctx, x, y, t, phase) {
    const g = Math.sin(t * 11 + phase);
    ctx.save();
    ctx.translate(x, y + Math.sin(t * 11 + phase) * 1.2);
    ctx.strokeStyle = '#5b3a1f';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    // legs, galloping
    ctx.beginPath();
    ctx.moveTo(-8, 3);
    ctx.lineTo(-12 - g * 5, 12);
    ctx.moveTo(-5, 3);
    ctx.lineTo(-7 + g * 4, 12);
    ctx.moveTo(7, 3);
    ctx.lineTo(11 + g * 5, 11);
    ctx.moveTo(9, 2);
    ctx.lineTo(14 - g * 4, 10);
    ctx.stroke();
    // body
    ctx.fillStyle = '#8a5a30';
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 5.5, -0.08, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f3e9da';
    ctx.beginPath();
    ctx.ellipse(-12, -2, 2.6, 2, 0, 0, TAU);
    ctx.fill();
    // neck and head
    ctx.fillStyle = '#8a5a30';
    ctx.beginPath();
    ctx.moveTo(8, -3);
    ctx.lineTo(15, -11);
    ctx.lineTo(18, -9);
    ctx.lineTo(13, -1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(18.5, -11, 4.6, 2.8, 0.25, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2b1a0e';
    ctx.beginPath();
    ctx.arc(22.6, -10, 1.1, 0, TAU);
    ctx.fill();
    // antlers
    ctx.strokeStyle = '#d6c09a';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(16, -13);
    ctx.lineTo(13, -21);
    ctx.moveTo(14.2, -17.5);
    ctx.lineTo(10.5, -18.5);
    ctx.moveTo(13.6, -19.5);
    ctx.lineTo(15.5, -23);
    ctx.moveTo(17.5, -13.5);
    ctx.lineTo(18.5, -21);
    ctx.moveTo(18.2, -18);
    ctx.lineTo(21.5, -19.5);
    ctx.stroke();
    // harness
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(4, -5);
    ctx.lineTo(9, 4);
    ctx.stroke();
    ctx.restore();
  }

  function drawSanta(ctx, s, e) {
    const t = s.t;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(s.k * s.dir, s.k);
    ctx.rotate(s.tilt * s.dir + Math.sin(t * 1.7 + 0.6) * 0.03);
    const deer = [[150, -4, 0], [118, 2, 1.7], [86, -4, 3.1], [54, 2, 4.4]];
    // reins
    ctx.strokeStyle = 'rgba(214,170,70,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(14, -14);
    for (const [dx, dy] of deer.slice().reverse()) ctx.lineTo(dx + 5, dy - 4);
    ctx.stroke();
    for (const [dx, dy, ph] of deer) drawReindeer(ctx, dx, dy, t, ph);

    // sack
    ctx.fillStyle = '#7a5530';
    ctx.beginPath();
    ctx.ellipse(-22, -14, 12, 10, -0.3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#5c3e22';
    ctx.fillRect(-25, -26, 6, 4);
    // Santa
    ctx.fillStyle = '#d33a2f';
    ctx.beginPath();
    ctx.ellipse(-2, -14, 10, 11, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f4d3b5';
    ctx.beginPath();
    ctx.arc(1, -28, 5.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(2.5, -23.5, 5.5, 5.2, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#d33a2f';
    ctx.beginPath();
    ctx.moveTo(-5, -31);
    ctx.quadraticCurveTo(1, -42, 9, -33 + Math.sin(t * 5) * 1.5);
    ctx.lineTo(5.5, -31.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-5.5, -32.5, 11.5, 3);
    ctx.beginPath();
    ctx.arc(9.5, -33 + Math.sin(t * 5) * 1.5, 2.2, 0, TAU);
    ctx.fill();
    // waving arm
    ctx.strokeStyle = '#d33a2f';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(4, -18);
    ctx.lineTo(12, -24 + Math.sin(t * 6) * 3);
    ctx.stroke();
    // sleigh
    const body = ctx.createLinearGradient(0, -14, 0, 4);
    body.addColorStop(0, '#e04a3c');
    body.addColorStop(1, '#a52a22');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-36, -14);
    ctx.quadraticCurveTo(-40, 2, -26, 4);
    ctx.lineTo(16, 4);
    ctx.quadraticCurveTo(30, 2, 30, -12);
    ctx.quadraticCurveTo(30, -18, 24, -16);
    ctx.quadraticCurveTo(22, -8, 14, -8);
    ctx.lineTo(-24, -8);
    ctx.quadraticCurveTo(-30, -10, -30, -16);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#f2c14e';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-30, -4);
    ctx.lineTo(20, -4);
    ctx.stroke();
    // runners
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-28, 4);
    ctx.lineTo(-24, 10);
    ctx.moveTo(14, 4);
    ctx.lineTo(10, 10);
    ctx.moveTo(-34, 10);
    ctx.lineTo(24, 10);
    ctx.quadraticCurveTo(34, 10, 33, 3);
    ctx.stroke();
    ctx.restore();
    void e;
  }

  Drift.Extras = Extras;
})();

/* src/renderer/overlay/engine.js */
/* The weather engine: surfaces (window tops, the ground, the Dock), piles, particles and the cursor. */
(function () {
  'use strict';
  const Drift = window.Drift;
  const U = Drift.util;

  const CELL = 3;           // px per heightmap cell
  const EDGE_TAPER = 16;    // px over which a pile rounds off at a window edge
  const SLOPE = 1.5;        // max height difference between neighbouring cells (angle of repose)
  const MAX_DT = 0.05;
  const MISSING_TTL = 180000;

  // ------------------------------------------------------------------ Surface
  class Surface {
    constructor(id, kind) {
      this.id = id;
      this.kind = kind;     // 'window' | 'ground' | 'dock'
      this.x = 0;
      this.y = 0;
      this.w = 0;
      this.n = 0;
      this.h = new Float32Array(0);
      this.cap = new Float32Array(0);
      this.tmp = new Float32Array(0);
      this.maxH = 0;
      this.taper = true;
      this.intervals = [];
      this.stuck = [];
      this.missingSince = 0;
      this.rx = 0;
      this.ry = 0;
      this.rw = 0;
      this.lastT = 0;
      this.mass = 0;        // rough sum of heights, to skip empty surfaces quickly
      this.lump = null;
    }

    setGeometry(x, y, w, maxH, taper) {
      const n = Math.max(1, Math.ceil(w / CELL));
      if (n !== this.n) {
        this.n = n;
        this.h = new Float32Array(n);
        this.cap = new Float32Array(n);
        this.tmp = new Float32Array(n);
        this.stuck.length = 0;
        this.mass = 0;
      }
      this.x = x;
      this.y = y;
      this.w = w;
      this.maxH = Math.max(0, maxH);
      this.taper = taper !== false;
      if (!this.lump) {
        let seed = 0;
        for (let k = 0; k < this.id.length; k++) seed = (seed * 31 + this.id.charCodeAt(k)) >>> 0;
        this.lump = U.makeFbm1D(seed, 3);
      }
      for (let i = 0; i < n; i++) {
        // A gently rolling crest instead of a flat slab when the pile is full.
        let c = this.maxH * (0.62 + 0.5 * (this.lump((i * CELL) / 70) * 0.5 + 0.5));
        if (this.taper) {
          const d = Math.min((i + 0.5) * CELL, w - (i + 0.5) * CELL);
          c *= Math.pow(U.clamp(d / EDGE_TAPER, 0, 1), 0.55);
        }
        this.cap[i] = c;
        if (this.h[i] > c) this.h[i] = c;
      }
    }

    clear() {
      this.h.fill(0);
      this.mass = 0;
      this.stuck.length = 0;
    }

    index(lx) {
      return Math.floor((lx - this.x) / CELL);
    }

    heightAt(lx) {
      const f = (lx - this.x) / CELL - 0.5;
      const i = Math.floor(f);
      const t = f - i;
      const a = this.h[U.clamp(i, 0, this.n - 1)];
      const b = this.h[U.clamp(i + 1, 0, this.n - 1)];
      return a + (b - a) * t;
    }

    topAt(lx) {
      return this.y - this.heightAt(lx);
    }

    visibleAt(lx) {
      const iv = this.intervals;
      for (let k = 0; k < iv.length; k++) {
        if (lx >= iv[k][0] && lx <= iv[k][1]) return true;
      }
      return false;
    }

    deposit(lx, amount) {
      const i = this.index(lx);
      if (i < 0 || i >= this.n || this.maxH <= 0) return;
      if (amount <= 1.2) {
        this._add(i - 1, amount * 0.25);
        this._add(i, amount * 0.5);
        this._add(i + 1, amount * 0.25);
        this.relax(i, 7, 3);
        return;
      }
      // A big clump lands as a soft mound, not a spike.
      const k = Math.min(10, Math.ceil(amount / 1.2));
      let norm = 0;
      for (let j = -k; j <= k; j++) norm += k + 1 - Math.abs(j);
      for (let j = -k; j <= k; j++) this._add(i + j, (amount * (k + 1 - Math.abs(j))) / norm);
      this.relax(i, k + 8, 5);
    }

    _add(i, a) {
      if (i < 0 || i >= this.n) return;
      const before = this.h[i];
      const v = Math.min(this.cap[i], before + a);
      this.h[i] = v;
      this.mass += v - before;
    }

    // Let steep spots slide sideways until they are no steeper than the angle of repose.
    relax(i, radius, passes) {
      const h = this.h;
      const cap = this.cap;
      const lo = Math.max(0, i - radius);
      const hi = Math.min(this.n - 2, i + radius);
      for (let pass = 0; pass < passes; pass++) {
        for (let k = lo; k <= hi; k++) {
          const diff = h[k] - h[k + 1];
          if (diff > SLOPE) {
            const m = (diff - SLOPE) * 0.5;
            h[k] -= m;
            h[k + 1] = Math.min(cap[k + 1], h[k + 1] + m);
          } else if (diff < -SLOPE) {
            const m = (-diff - SLOPE) * 0.5;
            h[k + 1] -= m;
            h[k] = Math.min(cap[k], h[k] + m);
          }
        }
      }
    }

    smooth() {
      if (this.mass <= 0.01) return;
      const h = this.h;
      const t = this.tmp;
      const n = this.n;
      let mass = 0;
      for (let k = 0; k < n; k++) {
        const l = h[k > 0 ? k - 1 : 0];
        const r = h[k < n - 1 ? k + 1 : n - 1];
        t[k] = Math.min(this.cap[k], h[k] * 0.8 + (l + r) * 0.1);
        mass += t[k];
      }
      h.set(t);
      this.mass = mass;
    }

    melt(amount) {
      if (this.mass <= 0.01) {
        this.mass = 0;
        return;
      }
      let mass = 0;
      const h = this.h;
      for (let k = 0; k < this.n; k++) {
        const v = h[k] - amount;
        h[k] = v > 0 ? v : 0;
        mass += h[k];
      }
      this.mass = mass;
    }
  }

  // ------------------------------------------------------------------ Engine
  class Engine {
    constructor(canvas, host) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.host = host || { send() {} };
      this.platform = 'darwin';
      this.display = {
        id: '0',
        bounds: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
        workArea: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
        scaleFactor: 1,
      };
      this.W = window.innerWidth;
      this.H = window.innerHeight;
      this.dpr = 1;
      this.settings = {
        effect: 'snow', intensity: 0.55, wind: 0.15, size: 1, pileUp: true,
        interactive: true, santa: true, snowmen: 1, fps: 60,
      };
      this.low = false;
      this.time = 0;
      this.pools = {};
      this.windowSurfaces = new Map();
      this.ground = new Surface('ground', 'ground');
      this.dockSurface = null;
      this.dockFrame = null;
      this.active = [];
      this.cursor = {
        x: -1e4, y: -1e4, vx: 0, vy: 0, speed: 0, on: false, still: 0,
        lastUpdate: 0, tx: -1e4, ty: -1e4,
      };
      this.windX = 0;
      this.noise = U.makeNoise1D(7);
      this.spawnAcc = 0;
      this.smoothAcc = 0;
      this.running = false;
      this.raf = 0;
      this.lastFrame = 0;
      this.lastStep = 0;
      this.effectName = null;
      this.effect = null;
      this.sprites = null;
      this.extras = new Drift.Extras(this);
      this.festive = Drift.Festive ? new Drift.Festive(this) : null; // not on the website
      this.letters = Drift.Letters ? new Drift.Letters(this) : null; // only in the app's overlay
      this.lastWindows = [];
      this._frame = this._frame.bind(this);
    }

    // ---------------------------------------------------------------- configuration
    configure(opts) {
      if (opts.platform) this.platform = opts.platform;
      if (opts.display) this.setDisplay(opts.display);
      if (opts.settings) this.setSettings(opts.settings, !!opts.low);
      if (opts.state) this.setState(opts.state);
      if (opts.windows) this.setWindows(opts.windows);
    }

    setDisplay(display) {
      this.display = display;
      this.W = display.bounds.width;
      this.H = display.bounds.height;
      this.resize();
      this.buildGround();
      this.setWindows(this.lastWindows);
    }

    resize() {
      // Always full sharpness: "save energy" halves particles and frame rate instead,
      // because drawing at 1x on a Retina screen makes everything (text included) blurry.
      const want = Math.min(2, window.devicePixelRatio || this.display.scaleFactor || 1);
      this.dpr = want;
      this.canvas.style.width = this.W + 'px';
      this.canvas.style.height = this.H + 'px';
      this.canvas.width = Math.round(this.W * want);
      this.canvas.height = Math.round(this.H * want);
      this.sprites = null; // rebuilt lazily at the new resolution
    }

    setSettings(s, low) {
      const prev = this.settings;
      this.settings = Object.assign({}, this.settings, s);
      this.low = !!low;
      if (prev.size !== this.settings.size) this.sprites = null;
      if (prev.pileUp !== this.settings.pileUp) this.buildGround();
      if (this.settings.effect !== this.effectName) this.setEffect(this.settings.effect);
      this.rebuildActive();
    }

    setEffect(name) {
      if (this.effectName === 'fireflies' && name !== 'fireflies') Drift.retireFireflies(this);
      this.effectName = name;
      this.effect = Drift.effects[name] || null;
      this.spawnAcc = 0;
      if (this.effect && this.effect.prefill) this.effect.prefill(this);
    }

    // What festivities are on (src/main/festivities.js): Advent decorations, Hanukkah lights, how dark it is.
    setFestive(state) {
      if (this.festive) this.festive.setState(state);
    }

    setState(state) {
      this.dockFrame = state && state.dock ? state.dock : null;
      this.buildGround();
      this.extras.setGift(state ? state.gift : null);
    }

    buildGround() {
      const d = this.display;
      const b = d.bounds;
      const wa = d.workArea;
      const W = this.W;
      const H = this.H;
      const sz = U.clamp(this.settings.size, 0.8, 1.3);
      let groundY;
      let maxH = 42 * sz;
      this.dockSurface = null;
      const dockAtBottom = (b.y + b.height) - (wa.y + wa.height) > 4;
      const f = this.dockFrame;
      const dockHere = this.platform === 'darwin' && f && f.w > f.h
        && f.x >= b.x - 2 && f.x + f.w <= b.x + b.width + 2 && f.y > b.y + b.height * 0.5 && f.y < b.y + b.height;
      if (this.platform === 'darwin') {
        groundY = H;
        if (dockAtBottom && !dockHere) maxH = 10;
      } else {
        groundY = wa.y + wa.height - b.y;   // top of a bottom taskbar, or the screen bottom
        if (groundY < H * 0.5) groundY = H;
      }
      if (!this.settings.pileUp) maxH = 0;
      this.ground.setGeometry(0, groundY, W, maxH, false);
      this.ground.intervals = [[0, W]];
      if (dockHere && this.settings.pileUp) {
        const dx = f.x - b.x;
        const s = new Surface('dock', 'dock');
        s.setGeometry(dx + 8, f.y - b.y, f.w - 16, 18 * sz, true);
        s.intervals = [[dx + 8, dx + f.w - 8]];
        this.dockSurface = s;
        this.ground.intervals = U.subtractInterval([[0, W]], dx - 2, dx + f.w + 2);
      }
      this.rebuildActive();
    }

    // Window rectangles arrive in global coordinates, front-most first.
    setWindows(list) {
      this.lastWindows = list || [];
      const now = performance.now();
      const b = this.display.bounds;
      const W = this.W;
      const H = this.H;
      const waTop = this.display.workArea.y - b.y;
      const sz = U.clamp(this.settings.size, 0.8, 1.3);
      const inset = this.platform === 'darwin' ? 9 : 5;
      const local = this.lastWindows.map((r) => ({ id: r.id, x: r.x - b.x, y: r.y - b.y, w: r.w, h: r.h }));
      const seen = new Set();

      for (let i = 0; i < local.length; i++) {
        const r = local[i];
        let s = this.windowSurfaces.get(r.id);
        const valid = r.y >= waTop + 22 && r.y <= H - 30 && r.x + r.w > 30 && r.x < W - 30 && r.w > 60;
        if (!valid) {
          // The top edge left this display or went flush with the top: let the snow drop.
          if (s && !s.missingSince) {
            this.shed(s, 0, 0);
            s.missingSince = now;
            s.intervals = [];
          }
          continue;
        }
        seen.add(r.id);
        const x0 = r.x + inset;
        const x1 = r.x + r.w - inset;
        const maxH = Math.max(0, Math.min(20 * sz, r.y - waTop - 6));
        if (!s) {
          s = new Surface(r.id, 'window');
          this.windowSurfaces.set(r.id, s);
          s.setGeometry(x0, r.y, x1 - x0, maxH, true);
        } else {
          const moved = Math.abs(s.rx - r.x) > 0.5 || Math.abs(s.ry - r.y) > 0.5 || Math.abs(s.rw - r.w) > 0.5;
          if (moved) {
            if (s.missingSince) {
              s.clear();
            } else {
              const dt = Math.max(0.05, (now - s.lastT) / 1000);
              this.shed(s, (r.x - s.rx) / dt, (r.y - s.ry) / dt);
            }
            s.setGeometry(x0, r.y, x1 - x0, maxH, true);
          }
        }
        s.rx = r.x;
        s.ry = r.y;
        s.rw = r.w;
        s.lastT = now;
        s.missingSince = 0;

        let iv = [[Math.max(0, x0), Math.min(W, x1)]];
        for (let j = 0; j < i && iv.length; j++) {
          const o = local[j];
          if (o.y < r.y + 2 && o.y + o.h > r.y - 8) iv = U.subtractInterval(iv, o.x - 2, o.x + o.w + 2);
        }
        s.intervals = iv.filter((p) => p[1] - p[0] >= 24);
      }

      for (const [id, s] of this.windowSurfaces) {
        if (seen.has(id)) continue;
        if (!s.missingSince) {
          // Closed, minimised or on another desktop: keep its snow out of sight for a while.
          s.missingSince = now;
          s.intervals = [];
        } else if (now - s.missingSince > MISSING_TTL) {
          this.windowSurfaces.delete(id);
        }
      }
      this.rebuildActive();
    }

    rebuildActive() {
      const list = [];
      if (this.settings.pileUp) {
        if (this.ground.intervals.length) list.push(this.ground);
        if (this.dockSurface) list.push(this.dockSurface);
        for (const s of this.windowSurfaces.values()) {
          if (!s.missingSince && s.intervals.length) list.push(s);
        }
      }
      this.active = list;
    }

    // ---------------------------------------------------------------- cursor
    setCursor(p) {
      const b = this.display.bounds;
      const x = p.x - b.x;
      const y = p.y - b.y;
      const now = performance.now();
      const c = this.cursor;
      const dt = (now - c.lastUpdate) / 1000;
      if (c.lastUpdate && dt > 0.001 && dt < 0.25 && c.on) {
        const vx = (x - c.tx) / dt;
        const vy = (y - c.ty) / dt;
        c.vx = c.vx * 0.4 + vx * 0.6;
        c.vy = c.vy * 0.4 + vy * 0.6;
      } else {
        c.vx = 0;
        c.vy = 0;
      }
      c.tx = x;
      c.ty = y;
      c.lastUpdate = now;
      c.on = x >= 0 && y >= 0 && x <= this.W && y <= this.H;
    }

    updateCursor(dt) {
      const c = this.cursor;
      c.x = c.tx;
      c.y = c.ty;
      if (performance.now() - c.lastUpdate > 60) {
        // No news means the pointer is resting.
        const k = Math.exp(-dt * 14);
        c.vx *= k;
        c.vy *= k;
      }
      c.speed = Math.hypot(c.vx, c.vy);
      if (c.on && c.speed < 15) c.still += dt;
      else c.still = 0;
    }

    // Stir a particle with the cursor: drag it along the pointer's motion and nudge it outward.
    push(p, radius, drag, repel, dt) {
      const c = this.cursor;
      if (!c.on || !this.settings.interactive) return false;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) return false;
      const d = Math.sqrt(d2) || 1;
      const f = (1 - d / radius) * (1 - d / radius);
      const k = Math.min(1, drag * f * dt);
      p.vx += (c.vx * 0.85 - p.vx) * k;
      p.vy += (c.vy * 0.85 - p.vy) * k;
      p.vx += (dx / d) * f * repel * dt;
      p.vy += (dy / d) * f * repel * dt;
      return true;
    }

    // ---------------------------------------------------------------- particles
    add(type, p) {
      p.type = type;
      (this.pools[type] || (this.pools[type] = [])).push(p);
      return p;
    }

    count(type) {
      const pool = this.pools[type];
      return pool ? pool.length : 0;
    }

    // The first surface (highest top) crossed while moving from prevY down to y at x.
    // Particles flagged `near` fall in front of windows and only land on the ground or the Dock.
    findHit(x, prevY, y, near) {
      let best = null;
      let bestTop = Infinity;
      const list = this.active;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (near && s.kind === 'window') continue;
        if (x < s.x || x > s.x + s.w) continue;
        const top = s.y - s.heightAt(x);
        if (prevY <= top && y >= top && top < bestTop && s.visibleAt(x)) {
          best = s;
          bestTop = top;
        }
      }
      return best ? { surface: best, top: bestTop } : null;
    }

    // Turn a surface's pile and resting items into falling debris (the window moved).
    shed(s, vx, vy) {
      const kvx = U.clamp(vx * 0.35, -500, 500);
      const kvy = U.clamp(vy * 0.35, -500, 300);
      if (s.mass > 0.5) {
        let budget = 260;
        for (let i = 0; i < s.n && budget > 0; i += 2) {
          const hh = Math.max(s.h[i], i + 1 < s.n ? s.h[i + 1] : 0);
          if (hh < 0.8) continue;
          const lx = s.x + (i + 1) * CELL;
          if (!s.visibleAt(lx)) continue;
          const vol = hh * CELL * 2;
          this.add('clump', {
            x: lx, y: s.y - hh * 0.5,
            vx: kvx + U.rand(-25, 25), vy: kvy + U.rand(-40, 10),
            r: U.clamp(Math.sqrt(vol) * 0.55, 1.5, 6), vol, life: 0,
          });
          budget--;
        }
      }
      for (const it of s.stuck) this.releaseStuck(s, it, kvx, kvy);
      s.clear();
    }

    releaseStuck(s, it, vx, vy) {
      const def = Drift.types[it.kind];
      if (def && def.release) def.release(this, s, it, vx, vy);
    }

    stick(s, item, maxItems) {
      s.stuck.push(item);
      const limit = maxItems || Math.max(4, Math.floor(s.w / 7));
      if (s.stuck.length > limit) s.stuck.shift();
    }

    shakeAll() {
      this.shed(this.ground, 0, -120);
      if (this.dockSurface) this.shed(this.dockSurface, 0, -120);
      for (const s of this.windowSurfaces.values()) {
        if (!s.missingSince) this.shed(s, 0, -160);
        else s.clear();
      }
    }

    // Sweeping the pointer through a pile knocks snow (and resting petals) off.
    sweepPiles() {
      const c = this.cursor;
      if (!c.on || !this.settings.interactive || c.speed < 120) return;
      const R = 12;
      for (const s of this.active) {
        if (c.x < s.x - R || c.x > s.x + s.w + R || !s.visibleAt(c.x)) continue;
        const top = s.topAt(c.x);
        if (c.y < top - 6 || c.y > s.y + 3) continue;
        if (s.mass > 0.3) {
          const i0 = Math.max(0, s.index(c.x - R));
          const i1 = Math.min(s.n - 1, s.index(c.x + R));
          for (let i = i0; i <= i1; i++) {
            const hh = s.h[i];
            if (hh < 0.5) continue;
            const take = hh * 0.75;
            s.h[i] = hh - take;
            s.mass -= take;
            if (i % 2 === 0) {
              const vol = take * CELL * 2;
              this.add('clump', {
                x: s.x + (i + 0.5) * CELL, y: s.y - hh * 0.6,
                vx: c.vx * 0.3 + U.rand(-30, 30), vy: Math.min(-30, c.vy * 0.3) + U.rand(-90, -20),
                r: U.clamp(Math.sqrt(vol) * 0.5, 1.2, 4.5), vol, life: 0,
              });
            }
          }
        }
        if (s.stuck.length) {
          const keep = [];
          for (const it of s.stuck) {
            if (Math.abs(s.x + it.rx - c.x) < R + 8) this.releaseStuck(s, it, c.vx * 0.4, Math.min(-40, c.vy * 0.3));
            else keep.push(it);
          }
          s.stuck = keep;
        }
      }
    }

    // ---------------------------------------------------------------- loop
    start() {
      if (this.running) return;
      this.running = true;
      this.lastFrame = 0;
      this.lastStep = 0;
      this.raf = requestAnimationFrame(this._frame);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    _frame(ts) {
      if (!this.running) return;
      this.raf = requestAnimationFrame(this._frame);
      const fps = this.low ? 30 : this.settings.fps || 60;
      if (this.lastFrame && ts - this.lastFrame < 1000 / fps - 3) return;
      const dt = this.lastStep ? Math.min(MAX_DT, (ts - this.lastStep) / 1000) : 1 / fps;
      this.lastFrame = ts;
      this.lastStep = ts;
      this.step(dt);
      this.draw();
    }

    step(dt) {
      this.time += dt;
      this.updateCursor(dt);
      const t = this.time;
      const gust = this.noise(t * 0.07) * 0.55 + this.noise(t * 0.21 + 40) * 0.25;
      this.windX = U.clamp(this.settings.wind + gust * 0.5, -1.6, 1.6);

      if (!this.sprites) this.sprites = Drift.buildSprites(this.dpr, this.settings.size);

      const eff = this.effect;
      if (eff) {
        const scale = (this.W / 1000) * (this.low ? 0.5 : 1);
        this.spawnAcc += eff.rate(this) * scale * dt;
        const cap = eff.max(this) * (this.low ? 0.5 : 1);
        let guard = 0;
        while (this.spawnAcc >= 1 && guard++ < 200) {
          this.spawnAcc -= 1;
          if (this.count(eff.type) < cap) eff.spawn(this, false);
        }
        if (eff.tick) eff.tick(this, dt);
      }

      for (const type in this.pools) {
        const def = Drift.types[type];
        const pool = this.pools[type];
        if (!def) {
          pool.length = 0;
          continue;
        }
        for (let i = pool.length - 1; i >= 0; i--) {
          if (def.update(pool[i], dt, this) === false) {
            pool[i] = pool[pool.length - 1];
            pool.pop();
          }
        }
      }

      // Piles: slow smoothing, melting when it is not snowing, the cursor sweeping snow away.
      const melt = this.effectName === 'snow' ? 0 : this.effectName === 'rain' ? 4 : 2.5;
      this.smoothAcc += dt;
      const doSmooth = this.smoothAcc > 0.3;
      if (doSmooth) this.smoothAcc = 0;
      const surfaces = [this.ground];
      if (this.dockSurface) surfaces.push(this.dockSurface);
      for (const s of this.windowSurfaces.values()) surfaces.push(s);
      for (const s of surfaces) {
        if (melt && s.mass > 0) s.melt(melt * dt);
        if (doSmooth) s.smooth();
        if (s.stuck.length) {
          for (let i = s.stuck.length - 1; i >= 0; i--) {
            const it = s.stuck[i];
            it.life += dt;
            if (it.life >= it.max) s.stuck.splice(i, 1);
          }
        }
      }
      this.sweepPiles();
      this.extras.update(dt);
      if (this.festive) this.festive.update(dt);
      if (this.letters) this.letters.update(dt);
    }

    // ---------------------------------------------------------------- drawing
    draw() {
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      const surfaces = [];
      if (this.ground.intervals.length) surfaces.push(this.ground);
      if (this.dockSurface) surfaces.push(this.dockSurface);
      for (const s of this.windowSurfaces.values()) {
        if (!s.missingSince && s.intervals.length) surfaces.push(s);
      }
      for (const s of surfaces) if (s.mass > 0.2) this.drawPile(ctx, s);
      if (this.festive) this.festive.drawBack(ctx);
      this.extras.drawBack(ctx);
      if (this.letters) this.letters.drawBack(ctx);
      for (const s of surfaces) {
        for (const it of s.stuck) {
          const def = Drift.types[it.kind];
          if (def && def.drawStuck && s.visibleAt(s.x + it.rx)) def.drawStuck(ctx, s, it, this);
        }
      }
      for (const type of Drift.drawOrder) {
        const pool = this.pools[type];
        if (pool && pool.length) Drift.types[type].draw(ctx, pool, this);
      }
      this.extras.drawFront(ctx);
      if (this.festive && this.festive.drawFront) this.festive.drawFront(ctx);
    }

    drawPile(ctx, s) {
      for (const [a, b] of s.intervals) {
        const i0 = Math.max(0, s.index(a));
        const i1 = Math.min(s.n - 1, s.index(b));
        if (i1 <= i0) continue;
        let any = false;
        for (let i = i0; i <= i1; i++) {
          if (s.h[i] > 0.35) {
            any = true;
            break;
          }
        }
        if (!any) continue;
        const pts = [];
        pts.push([a, s.y]);
        for (let i = i0; i <= i1; i++) {
          const x = U.clamp(s.x + (i + 0.5) * CELL, a, b);
          pts.push([x, s.y - s.h[i]]);
        }
        pts.push([b, s.y]);
        let maxH = 0;
        for (let i = i0; i <= i1; i++) if (s.h[i] > maxH) maxH = s.h[i];

        ctx.beginPath();
        ctx.moveTo(pts[0][0], s.y + 0.5);
        for (let k = 1; k < pts.length - 1; k++) {
          const mx = (pts[k][0] + pts[k + 1][0]) * 0.5;
          const my = (pts[k][1] + pts[k + 1][1]) * 0.5;
          ctx.quadraticCurveTo(pts[k][0], pts[k][1], mx, my);
        }
        ctx.lineTo(b, s.y + 0.5);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, s.y - maxH, 0, s.y);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.65, '#f4f8fd');
        g.addColorStop(1, '#dfe8f3');
        ctx.fillStyle = g;
        ctx.fill();
        // A faint outline keeps snow readable on white title bars.
        ctx.strokeStyle = 'rgba(120,140,170,0.45)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
  }

  Drift.Engine = Engine;
  Drift.Surface = Surface;
  Drift.CELL = CELL;
})();

/* Drift's real weather on the website. build.js puts the app's own engine files above this one, so
   everything here runs exactly the weather the app runs:

   - one weather for the whole site, picked in the live demo or in the weather menu (like Drift's icon
     in the menu bar) and remembered in this browser only;
   - the live demo at the top of the home page (the two cards are the "windows" snow piles up on);
   - a little desktop inside each feature window, showing that feature by itself;
   - the site's own weather layer, behind the content (like "Desktop only"), settling on the top of
     every window on the page and staying on it while you scroll. */
(function () {
  'use strict';
  const D = window.Drift;
  const dataEl = document.getElementById('site-data');
  if (!D || !D.Engine || !dataEl) return;
  const data = JSON.parse(dataEl.textContent);
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const rand = (a, b) => a + Math.random() * (b - a);

  const WEATHERS = ['snow', 'rain', 'sakura', 'leaves', 'fireflies', 'starfall'];
  const SCENE_OF = { snow: 'winter', rain: 'rain', sakura: 'sakura', leaves: 'autumn', fireflies: 'meadow', starfall: 'peaks' };
  const root = document.documentElement;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const noHover = window.matchMedia && matchMedia('(hover: none)').matches;
  const narrow = () => window.innerWidth < 700;

  function makeEngine(canvas, display, settings, before) {
    const e = new D.Engine(canvas, { send() {} });
    e.strings = { gift: data.gift, lang: data.lang };
    if (before) before(e);
    e.configure({ platform: 'darwin', display, settings, low: false, state: { gift: null, dock: null } });
    return e;
  }

  const boxDisplay = (W, H, top) => ({
    id: '1',
    bounds: { x: 0, y: 0, width: W, height: H },
    workArea: { x: 0, y: top || 0, width: W, height: H - (top || 0) },
    scaleFactor: window.devicePixelRatio || 1,
  });

  // Snow already lying around, so the first look is wintry.
  function seed(surface, amount) {
    if (!surface || !surface.n) return;
    let mass = 0;
    for (let i = 0; i < surface.n; i++) {
      const v = surface.cap[i] * amount * (0.82 + 0.18 * Math.sin(i * 0.37));
      if (v > surface.h[i]) surface.h[i] = v;
      mass += surface.h[i];
    }
    surface.mass = mass;
  }

  // Run an engine only while its box is on screen.
  function whenVisible(el, cb, margin) {
    if (!('IntersectionObserver' in window)) return cb(true);
    new IntersectionObserver((entries) => cb(entries.some((x) => x.isIntersecting)), { rootMargin: margin || '0px' }).observe(el);
  }

  // ================================================================ the site's weather
  const KEY = 'drift-weather';
  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch (_) { /* private mode */ }
  const site = {
    weather: WEATHERS.includes(stored) || stored === 'off' ? stored : 'snow',
    chosen: !!stored,
    listeners: [],
  };

  function setSiteWeather(w, remember) {
    if (w !== 'off' && !WEATHERS.includes(w)) return;
    site.weather = w;
    if (w === 'off') {
      root.dataset.off = '';
    } else {
      delete root.dataset.off;
      root.dataset.weather = w;
    }
    if (remember) {
      site.chosen = true;
      try { localStorage.setItem(KEY, w); } catch (_) { /* private mode */ }
    }
    showMenu();
    site.listeners.forEach((fn) => fn(w));
  }

  // ---------------------------------------------------------------- the weather menu
  const menuBtn = $('.wmenu-btn');
  const menuPop = $('#wmenu-pop');
  function showMenu() {
    const label = $('.wmenu-label');
    if (label) label.textContent = data.status[site.weather] || '';
    $$('.wmenu-item').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.weather === site.weather)));
  }
  function openMenu(open) {
    if (!menuPop) return;
    menuPop.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) { const on = $('.wmenu-item[aria-checked="true"]') || $('.wmenu-item'); if (on) on.focus(); }
  }
  if (menuBtn && menuPop) {
    menuBtn.addEventListener('click', (e) => { e.stopPropagation(); openMenu(menuPop.hidden); });
    $$('.wmenu-item').forEach((b) => b.addEventListener('click', () => {
      setSiteWeather(b.dataset.weather, true);
      openMenu(false);
      menuBtn.focus();
    }));
    document.addEventListener('click', (e) => { if (!menuPop.hidden && !menuPop.contains(e.target)) openMenu(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menuPop.hidden) { openMenu(false); menuBtn.focus(); } });
  }
  showMenu();

  // ================================================================ the live demo (home page)
  const stage = document.getElementById('stage');
  let hero = null;
  if (stage) hero = startHero();

  function startHero() {
    const canvas = document.getElementById('weather');
    const pics = $$('.hero-pic', stage);
    const nowSlot = (pics[0] && pics[0].dataset.slot) || 'day';
    const wins = $$('.win', stage);
    const notes = $('.win-notes', stage);
    const pauseBtn = document.getElementById('pause');
    const hint = document.getElementById('hint');
    const buttons = $$('.picker .wx');
    let weather = site.weather;
    let order = ['notes', 'copy'];
    let visible = true;
    let paused = reduceMotion;

    const navHeight = () => { const n = $('.nav'); return n ? n.offsetHeight : 64; };
    const display = () => boxDisplay(Math.max(320, Math.round(stage.clientWidth)), Math.max(320, Math.round(stage.clientHeight)), navHeight());

    function rects() {
      const s = stage.getBoundingClientRect();
      const list = [];
      for (const id of order) {
        const w = $(`.win[data-win="${id}"]`, stage);
        if (!w || !w.offsetParent || getComputedStyle(w).display === 'none') continue;
        const r = w.getBoundingClientRect();
        list.push({ id, x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height });
      }
      return list;
    }
    const syncWindows = () => engine.setWindows(rects());

    function settings() {
      return {
        effect: weather, intensity: narrow() ? 0.42 : 0.52, wind: 0.15, size: narrow() ? 0.9 : 1,
        pileUp: true, interactive: true, santa: true, snowmen: narrow() ? 1 : 2, fps: 60,
      };
    }

    function seedSnow() {
      if (weather !== 'snow') return;
      if (engine.ground.mass < engine.ground.n * 4) seed(engine.ground, 0.72);
      for (const s of engine.windowSurfaces.values()) if (s.mass < s.n * 2) seed(s, 0.55);
    }

    const engine = makeEngine(canvas, display(), settings());
    syncWindows();
    seedSnow();

    // The gift's note is placed in screen coordinates by the engine: keep it inside the stage.
    const updateNote = engine.extras.updateNote.bind(engine.extras);
    engine.extras.updateNote = function () {
      updateNote();
      if (this.note && this.note.parentNode !== stage) stage.appendChild(this.note);
    };

    function frame() { engine.step(1 / 60); engine.draw(); }
    function update() {
      const run = visible && !paused && !document.hidden;
      if (run && !engine.running) engine.start();
      if (!run && engine.running) { engine.stop(); engine.draw(); }
    }
    whenVisible(stage, (v) => { visible = v; update(); });
    document.addEventListener('visibilitychange', update);
    frame();
    update();

    // pointer
    const point = (x, y) => { const r = stage.getBoundingClientRect(); engine.setCursor({ x: x - r.left, y: y - r.top }); };
    const away = () => engine.setCursor({ x: -1e4, y: -1e4 });
    let liftTimer = 0;
    stage.addEventListener('pointermove', (e) => point(e.clientX, e.clientY), { passive: true });
    stage.addEventListener('pointerdown', (e) => { clearTimeout(liftTimer); point(e.clientX, e.clientY); }, { passive: true });
    stage.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') away(); });
    const lift = () => { clearTimeout(liftTimer); liftTimer = setTimeout(away, 900); };
    stage.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) point(t.clientX, t.clientY); }, { passive: true });
    stage.addEventListener('touchend', lift, { passive: true });
    stage.addEventListener('touchcancel', lift, { passive: true });

    // windows
    function front(id) {
      order = [id].concat(order.filter((x) => x !== id));
      order.forEach((wid, k) => { const w = $(`.win[data-win="${wid}"]`, stage); if (w) w.style.zIndex = String(4 - k); });
      syncWindows();
    }
    wins.forEach((w) => w.addEventListener('pointerdown', () => { if (order[0] !== w.dataset.win) front(w.dataset.win); }));
    front('copy');

    if (notes) {
      const bar = $('[data-drag]', notes);
      let drag = null;
      bar.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        bar.setPointerCapture(e.pointerId);
        drag = { dx: e.clientX - notes.offsetLeft, dy: e.clientY - notes.offsetTop };
        notes.classList.add('dragging');
        front('notes');
      });
      bar.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const W = stage.clientWidth;
        const H = stage.clientHeight;
        const w = notes.offsetWidth;
        notes.style.left = Math.min(W - 60, Math.max(60 - w, e.clientX - drag.dx)) + 'px';
        notes.style.top = Math.min(H - 60, Math.max(navHeight() + 4, e.clientY - drag.dy)) + 'px';
        notes.style.right = 'auto';
        syncWindows();
      });
      const end = () => { if (!drag) return; drag = null; notes.classList.remove('dragging'); };
      bar.addEventListener('pointerup', end);
      bar.addEventListener('pointercancel', end);
    }

    let resizeTimer = 0;
    let lastW = stage.clientWidth;
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const W = stage.clientWidth;
          if (Math.abs(W - lastW) > 40 && notes) { notes.style.left = ''; notes.style.top = ''; notes.style.right = ''; }
          lastW = W;
          engine.setDisplay(display());
          engine.setSettings(settings(), false);
          syncWindows();
          seedSnow();
          if (!engine.running) frame();
        }, 120);
      }).observe(stage);
    }

    // weathers
    function pictureFor(w) {
      if (w === 'starfall') return 'night';
      if (w === 'fireflies') return nowSlot === 'night' ? 'night' : 'evening';
      return nowSlot;
    }
    function showPicture(w) {
      if (pics.length < 2 || !SCENE_OF[w]) return;
      const url = `${data.sceneBase}${SCENE_OF[w]}/${pictureFor(w)}-1920.webp`;
      const on = pics.find((p) => p.classList.contains('is-on')) || pics[0];
      if (on.getAttribute('src') === url) return;
      const next = on === pics[0] ? pics[1] : pics[0];
      next.onload = () => { next.classList.add('is-on'); on.classList.remove('is-on'); };
      next.src = url;
    }
    function showHint(w) {
      if (!hint) return;
      hint.textContent = '';
      const b = document.createElement('strong');
      b.textContent = data.weatherNames[w] || '';
      hint.append(b);
      const text = w === 'off' ? data.status.off : (noHover ? data.touchHints : data.hints)[w];
      if (w !== 'off') hint.append(' · ');
      const s = document.createElement('span');
      s.textContent = w === 'off' ? '' : text;
      hint.append(s);
    }
    function apply(w) {
      weather = w;
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.weather === w)));
      engine.setSettings(settings(), false);
      showPicture(w);
      showHint(w);
      santa(w === 'snow' ? 6000 : 0);
      if (w === 'snow') seedSnow();
      if (!engine.running) frame();
    }
    buttons.forEach((b) => b.addEventListener('click', () => setSiteWeather(b.dataset.weather, true)));
    site.listeners.push(apply);

    // Santa: every 40 seconds while it snows, with a gift to open when there isn't one waiting.
    let santaTimer = 0;
    let gifts = 0;
    function santa(delay) {
      clearTimeout(santaTimer);
      if (!delay) return;
      santaTimer = setTimeout(() => {
        if (weather === 'snow' && engine.running) {
          const waiting = engine.extras.gift && !(engine.extras.gift.opening > 0);
          engine.extras.callSanta(waiting ? null : { day: 'demo-' + (++gifts), displayId: '1', xFrac: 0.56 + Math.random() * 0.3, opened: false });
        }
        santa(40000);
      }, delay);
    }

    // pause
    function showPause() {
      if (!pauseBtn) return;
      pauseBtn.setAttribute('aria-pressed', String(paused));
      const label = paused ? pauseBtn.dataset.play : pauseBtn.dataset.pause;
      pauseBtn.title = label;
      $('.sr', pauseBtn).textContent = label;
    }
    if (pauseBtn) pauseBtn.addEventListener('click', () => { paused = !paused; showPause(); update(); });
    showPause();

    apply(weather);
    return { engine, stage, syncWindows };
  }

  // ================================================================ the little desktops in the feature windows
  const vignettes = [];
  $$('.vignette').forEach(startVignette);

  function startVignette(el) {
    const kind = el.dataset.vignette;
    if (kind === 'paintings') return paintings(el);
    const canvas = $('canvas', el);
    const mini = $('.mini', el);
    const weather = el.dataset.weather;
    const intensity = { settle: 0.8, pointer: 0.6, layers: 0.75, pause: 0.75, surprises: 0.55 }[kind] || 0.6;
    let visible = false;
    let holding = false;          // the "full-screen app" is showing: weather pauses, like in the app
    let script = null;            // a pretend pointer when the visitor's isn't there
    let realUntil = 0;

    const size = () => boxDisplay(Math.max(200, Math.round(el.clientWidth)), Math.max(110, Math.round(el.clientHeight)), 0);
    const engine = makeEngine(canvas, size(), {
      effect: weather, intensity, wind: 0.18, size: 0.8, pileUp: true, interactive: true, santa: true,
      snowmen: kind === 'surprises' ? 2 : 0, fps: 60,
    });
    vignettes.push(engine);
    if (kind === 'surprises') engine.extras.updateNote = function () { /* no note in a box this small */ };

    function rects() {
      if (!mini) return [];
      const b = el.getBoundingClientRect();
      const r = mini.getBoundingClientRect();
      return [{ id: 'mini', x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height }];
    }
    const step = engine.step.bind(engine);
    engine.step = function (dt) {
      engine.setWindows(rects());
      if (script && performance.now() > realUntil) {
        const p = script(engine.time);
        engine.cursor.lastUpdate = performance.now() - 16;
        engine.setCursor(p || { x: -1e4, y: -1e4 });
      }
      if (kind === 'pointer') moveUmbrella();
      step(dt);
    };
    engine.setWindows(rects());
    if (weather === 'snow') {
      seed(engine.ground, kind === 'surprises' ? 0.9 : 0.55);
      for (const s of engine.windowSurfaces.values()) seed(s, 0.5);
    }

    const umbrella = $('.umbrella', el);
    function moveUmbrella() {
      if (!umbrella) return;
      const c = engine.cursor;
      el.style.setProperty('--ux', (c.on ? c.tx - 70 : -300) + 'px');
      el.style.setProperty('--uy', (c.on ? c.ty - 66 : -300) + 'px');
    }

    // the visitor's own pointer takes over for a moment
    el.addEventListener('pointermove', (e) => {
      const b = el.getBoundingClientRect();
      realUntil = performance.now() + 2500;
      engine.setCursor({ x: e.clientX - b.left, y: e.clientY - b.top });
    }, { passive: true });
    el.addEventListener('pointerleave', () => { realUntil = 0; if (!script) engine.setCursor({ x: -1e4, y: -1e4 }); });

    function update() {
      const run = visible && !holding && !reduceMotion && !document.hidden;
      if (run && !engine.running) engine.start();
      if (!run && engine.running) { engine.stop(); if (!holding) engine.draw(); }
    }
    whenVisible(el, (v) => { visible = v; update(); }, '60px');
    document.addEventListener('visibilitychange', update);
    engine.step(1 / 60);
    engine.draw();

    if ('ResizeObserver' in window) {
      let t = 0;
      new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { engine.setDisplay(size()); if (!engine.running) { engine.step(1 / 60); engine.draw(); } }, 150); }).observe(el);
    }
    if (reduceMotion) return;

    const every = (ms, fn) => setInterval(() => { if (visible && !document.hidden) fn(); }, ms);

    if (kind === 'settle') {
      // the window moves now and then, and everything on it slides off
      let right = false;
      every(6000, () => { right = !right; mini.style.left = right ? '50%' : '6%'; });
    }
    if (kind === 'pointer') {
      // an umbrella wanders through the rain
      script = (t) => ({ x: el.clientWidth * (0.5 + 0.3 * Math.sin(t * 0.55)), y: el.clientHeight * (0.42 + 0.1 * Math.sin(t * 1.1)) });
    }
    if (kind === 'layers') {
      // over everything, then desktop only
      const label = $('[data-layer]', el);
      every(3600, () => {
        const behind = !el.classList.contains('behind');
        el.classList.toggle('behind', behind);
        if (label) label.textContent = behind ? data.text.desktopOnly : data.text.overEverything;
      });
    }
    if (kind === 'pause') {
      // a full-screen app opens: the weather pauses, and comes back after
      every(7000, () => {
        mini.classList.add('full');
        setTimeout(() => { holding = true; el.classList.add('paused'); update(); }, 800);
        setTimeout(() => { mini.classList.remove('full'); el.classList.remove('paused'); holding = false; update(); }, 3400);
      });
    }
    if (kind === 'surprises') {
      // Santa drops a gift; a pretend pointer rests on it, and it opens
      let n = 0;
      let target = null;
      script = () => target;
      every(9000, () => {
        engine.extras.callSanta({ day: 'v' + (++n), displayId: '1', xFrac: 0.66, opened: false });
        target = null;
        const wait = setInterval(() => {
          const g = engine.extras.gift;
          if (g && !g.falling && !(g.opening > 0)) {
            clearInterval(wait);
            setTimeout(() => {
              target = { x: g.x, y: g.y - g.h * 0.5 };
              setTimeout(() => { target = null; }, 1600);
            }, 900);
          }
        }, 200);
        setTimeout(() => clearInterval(wait), 8000);
      });
    }
  }

  // The paintings follow the day: the five pictures in turn, with the sun and the moon on their way.
  function paintings(el) {
    const pics = $$('.vg-pic', el);
    const label = $('[data-period]', el);
    const arc = $('.arc', el);
    const body = $('.arc-body', el);
    const SLOTS = ['dawn', 'day', 'golden', 'evening', 'night'];
    const angle = [0.86, 0.5, 0.14, 0.82, 0.46];
    let k = 0;
    let visible = false;
    function show() {
      pics.forEach((p, i) => { if (i === k) p.setAttribute('data-on', ''); else p.removeAttribute('data-on'); });
      if (label) label.textContent = data.periods[SLOTS[k]];
      if (arc && body) {
        const w = arc.clientWidth;
        const h = arc.clientHeight;
        const a = Math.PI * angle[k];
        body.style.setProperty('--ax', (w / 2 + (w / 2) * Math.cos(a)).toFixed(1) + 'px');
        body.style.setProperty('--ay', (h / 2 - (h / 2) * Math.sin(a)).toFixed(1) + 'px');
        body.classList.toggle('moon', k >= 3);
        body.style.transition = 'transform 1.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
      }
    }
    show();
    whenVisible(el, (v) => { visible = v; });
    if (reduceMotion) return;
    setInterval(() => { if (visible && !document.hidden) { k = (k + 1) % SLOTS.length; show(); } }, 2600);
  }

  // ================================================================ the site's weather layer
  const layer = document.getElementById('page-weather');
  if (layer) startLayer();

  function startLayer() {
    const wins = $$('.win[data-settle]');
    wins.forEach((w, k) => { w.dataset.wid = 'w' + k; });
    const navHeight = () => { const n = $('.nav'); return n ? n.offsetHeight : 64; };
    const display = () => boxDisplay(window.innerWidth, window.innerHeight, navHeight());
    const settings = () => ({
      effect: site.weather, intensity: narrow() ? 0.3 : 0.4, wind: 0.12, size: 0.92,
      pileUp: true, interactive: true, santa: true, snowmen: 0, fps: 60,
    });
    // no ground: the bottom of the window is not the bottom of the page
    const engine = makeEngine(layer, display(), settings(), (e) => {
      const build = e.buildGround.bind(e);
      e.buildGround = function () { build(); this.ground.intervals = []; this.rebuildActive(); };
    });

    // Windows move when the page scrolls; their snow moves with them instead of falling off.
    const docY = new Map();
    function sync() {
      const H = window.innerHeight;
      const top = navHeight();
      const sy = window.scrollY;
      const list = [];
      const now = performance.now();
      for (const el of wins) {
        // a window still drifting down to its place doesn't catch snow yet
        if (el.classList.contains('reveal') && !reduceMotion && (!el.classList.contains('in') || now - Number(el.dataset.landed || 0) < 1300)) continue;
        const r = el.getBoundingClientRect();
        const id = el.dataset.wid;
        const y = r.top + sy;
        const s = engine.windowSurfaces.get(id);
        if (s && Math.abs((docY.get(id) || 0) - y) < 1.5 && Math.abs(s.rx - r.left) < 0.5 && Math.abs(s.rw - r.width) < 0.5) {
          s.y = r.top;
          s.ry = r.top;
        }
        docY.set(id, y);
        if (r.width > 60 && r.top >= top + 24 && r.top <= H - 32) list.push({ id, x: r.left, y: r.top, w: r.width, h: r.height });
      }
      engine.setWindows(list);
      // like the demo at the top: when it snows, a window arrives with some snow already on it
      for (const item of list) {
        if (capped.has(item.id)) continue;
        capped.add(item.id);
        if (site.weather === 'snow') seed(engine.windowSurfaces.get(item.id), 0.6);
      }
    }
    const capped = new Set();
    const step = engine.step.bind(engine);
    engine.step = function (dt) { sync(); step(dt); };

    // the pointer plays with this weather too (but not over the live demo, which has its own)
    document.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      if (stage && stage.contains(e.target)) { engine.setCursor({ x: -1e4, y: -1e4 }); return; }
      engine.setCursor({ x: e.clientX, y: e.clientY });
    }, { passive: true });
    document.addEventListener('pointerleave', () => engine.setCursor({ x: -1e4, y: -1e4 }));

    // Over the live demo, only the demo snows.
    let heroShowing = !!stage;
    if (stage && 'IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        heroShowing = entries.some((x) => x.isIntersecting && x.intersectionRatio > 0.45);
        update();
      }, { threshold: [0, 0.45, 0.5, 1] }).observe(stage);
    } else {
      heroShowing = false;
    }

    function allowed() {
      if (site.weather === 'off') return false;
      return !reduceMotion || site.chosen;
    }
    function update() {
      const run = allowed() && !heroShowing && !document.hidden;
      if (run && !engine.running) engine.start();
      if (!run && engine.running) engine.stop();
    }
    document.addEventListener('visibilitychange', update);
    window.addEventListener('resize', () => { engine.setDisplay(display()); }, { passive: true });
    site.listeners.push(() => { engine.setSettings(settings(), false); update(); });
    update();

    // A window that has just landed shakes a little snow off its top.
    document.addEventListener('drift:landed', (e) => {
      const w = e.target;
      if (!w.matches || !w.matches('.win[data-settle]')) return;
      w.dataset.landed = String(performance.now() + (Number(getComputedStyle(w).getPropertyValue('--d')) || 0) * 120);
      setTimeout(() => {
        if (site.weather !== 'snow' || !engine.running) return;
        const r = w.getBoundingClientRect();
        for (let k = 0; k < 14; k++) {
          engine.add('clump', { x: r.left + 20 + Math.random() * (r.width - 40), y: r.top - 3, vx: rand(-70, 70), vy: rand(-190, -70), r: rand(1.4, 2.8), vol: 3, life: 0 });
        }
      }, 650);
    });

    // Santa crosses the sky when the gift notes come into view (while it snows).
    const gifts = $('.gifts');
    let lastSanta = 0;
    if (gifts) {
      whenVisible(gifts, (v) => {
        if (v && site.weather === 'snow' && engine.running && performance.now() - lastSanta > 25000) {
          lastSanta = performance.now();
          engine.extras.callSanta(null);
        }
      });
    }

    window.driftSite = Object.assign(window.driftSite || {}, { layer: engine });
  }

  window.driftSite = Object.assign(window.driftSite || {}, {
    setWeather: (w) => setSiteWeather(w, true),
    get weather() { return site.weather; },
    vignettes,
    hero: hero && hero.engine,
  });
  // the old name, used by the checks
  if (hero) window.driftDemo = { engine: hero.engine, setWeather: (w) => setSiteWeather(w, true), syncWindows: hero.syncWindows };
})();
