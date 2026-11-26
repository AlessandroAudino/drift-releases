/* The Drift website: language choice, the download buttons (always the newest version), the
   scene viewer and small touches. The live weather demo is in demo.js. */
(function () {
  'use strict';
  const el = document.getElementById('site-data');
  const data = el ? JSON.parse(el.textContent) : {};
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

  // ---------------------------------------------------------------- language
  // Remember a language picked by hand, so the English pages don't send the visitor away again.
  $$('.lang a[data-lang]').forEach((a) => a.addEventListener('click', () => {
    try { localStorage.setItem('drift-lang', a.dataset.lang); } catch (_) { /* private mode */ }
  }));
  document.addEventListener('click', (e) => {
    const open = $('.lang[open]');
    if (open && !open.contains(e.target)) open.removeAttribute('open');
  });

  // ---------------------------------------------------------------- which computer
  function detectOS() {
    const ua = navigator.userAgent || '';
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    if (/iPhone|iPad|iPod|Android/i.test(ua) || (/Mac/i.test(platform) && navigator.maxTouchPoints > 1)) return 'mobile';
    if (/Mac/i.test(platform) || /Macintosh/.test(ua)) return 'mac';
    if (/Win/i.test(platform) || /Windows/.test(ua)) return 'windows';
    if (/Linux|CrOS/i.test(platform + ua)) return 'linux';
    return 'other';
  }

  // Apple silicon or Intel? Chrome and Edge say so; Safari doesn't, and most Macs now have Apple chips.
  async function macChip() {
    try {
      if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        const v = await navigator.userAgentData.getHighEntropyValues(['architecture']);
        if (v.architecture === 'arm') return 'arm';
        if (v.architecture === 'x86') return 'intel';
      }
    } catch (_) { /* not available */ }
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      if (/Apple M\d/i.test(r)) return 'arm';
      if (/Intel|AMD|Radeon|NVIDIA/i.test(r)) return 'intel';
    } catch (_) { /* no WebGL */ }
    return 'arm';
  }

  const os = detectOS();
  document.documentElement.dataset.os = os;

  // The hero button says which computer it's for.
  $$('[data-os-label]').forEach((a) => {
    try {
      const labels = JSON.parse(a.dataset.osLabel);
      if (labels[os]) a.querySelector('span').textContent = labels[os];
    } catch (_) { /* keep the default label */ }
  });

  // ---------------------------------------------------------------- downloads
  function links(version, files) {
    const base = `https://github.com/${data.repo}/releases/download/v${version}/`;
    return {
      version,
      macArm: base + `Drift-${version}-mac-arm64.dmg`,
      macIntel: base + `Drift-${version}-mac-x64.dmg`,
      win: (files && files['win32-x64'] && files['win32-x64'].url) || base + `Drift-Setup-${version}.exe`,
      linux: (files && files['linux-x64'] && files['linux-x64'].url) || base + `Drift-${version}-linux-x86_64.AppImage`,
    };
  }

  function formatDate(iso) {
    try {
      return new Intl.DateTimeFormat(data.lang, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso));
    } catch (_) {
      return String(iso).slice(0, 10);
    }
  }

  function showDownloads(d, date) {
    $$('a[data-file]').forEach((a) => {
      if (d[a.dataset.file]) a.href = d[a.dataset.file];
    });
    const v = $('#version');
    if (v) v.textContent = fill(data.text.version, { version: d.version }) + (date ? ' · ' + fill(data.text.released, { date: formatDate(date) }) : '');
  }

  async function refreshDownloads() {
    if (!$('a[data-file]')) return;
    try {
      const res = await fetch(data.feed, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const feed = await res.json();
      if (!feed || !/^\d+\.\d+\.\d+$/.test(String(feed.version))) throw new Error('no version');
      showDownloads(links(feed.version, feed.files), feed.date);
    } catch (_) {
      if (!data.downloads) {
        const u = $('#unavailable');
        if (u) u.hidden = false;
        const v = $('#version');
        if (v) v.hidden = true;
      }
    }
  }

  async function arrangeDownloadPage() {
    const mac = $('.platform[data-os="mac"]');
    const win = $('.platform[data-os="windows"]');
    if (!mac || !win) return;
    if (os === 'windows') {
      win.classList.add('is-yours');
      win.parentNode.insertBefore(win, mac);
      const g = $('.guide[data-os="windows"]');
      if (g) g.parentNode.insertBefore(g, g.parentNode.firstElementChild);
    } else if (os === 'mac') {
      mac.classList.add('is-yours');
      if ((await macChip()) === 'intel') {
        const arm = $('[data-file="macArm"]', mac);
        const intel = $('[data-file="macIntel"]', mac);
        arm.classList.replace('btn-big', 'btn-soft');
        intel.classList.replace('btn-soft', 'btn-big');
        // Intel first: [Intel, its note, Apple silicon, its note]
        const box = arm.parentNode;
        const intelNote = intel.nextElementSibling;
        box.insertBefore(intel, arm);
        box.insertBefore(intelNote, arm);
      }
    }
  }

  if (data.page === 'download') {
    arrangeDownloadPage();
    refreshDownloads();
  }

  // ---------------------------------------------------------------- copy buttons
  $$('button.copy').forEach((b) => b.addEventListener('click', async () => {
    const text = b.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      try { document.execCommand('copy'); } catch (__) { /* nothing more to try */ }
      t.remove();
    }
    const label = $('span', b);
    label.textContent = data.text.copied;
    setTimeout(() => { label.textContent = data.text.copy; }, 1800);
  }));

  // ---------------------------------------------------------------- nav over the hero
  const nav = $('.nav.over-hero');
  if (nav) {
    const onScroll = () => nav.classList.toggle('solid', window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------------------------------------------------------------- arriving: drift down and settle
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const arriving = $$('.reveal, .drift');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
          e.target.dispatchEvent(new CustomEvent('drift:landed', { bubbles: true }));
        }
      }
    }, { rootMargin: '0px 0px -10% 0px' });
    arriving.forEach((r) => io.observe(r));
  } else {
    arriving.forEach((r) => r.classList.add('in'));
  }

  // ---------------------------------------------------------------- the sky: a day goes by
  // On the home page the time of day follows the scroll (dawn below the demo, night at the bottom);
  // on the other pages it follows the visitor's clock, like Drift's wallpapers.
  // [time, top of the sky, bottom of the sky]: dawn, day, golden hour, sunset, evening, night
  const SKY = {
    light: [[0, '#f4b9b3', '#fde6d2'], [1, '#69aaec', '#d6ebfd'], [2, '#f0985a', '#fcd9a2'], [2.5, '#b4507e', '#f2906c'], [3, '#3a2f78', '#8a4c8e'], [4, '#050a1f', '#141c46']],
    dark: [[0, '#2a1f33', '#4a3340'], [1, '#10243f', '#1f3d5e'], [2, '#2b1b3d', '#7a3f1f'], [2.5, '#2a1236', '#5a2440'], [3, '#17143a', '#33203f'], [4, '#03061a', '#0b1030']],
  };
  const darkScheme = window.matchMedia && matchMedia('(prefers-color-scheme: dark)');
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mixRgb = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));
  const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const lum = (c) => {
    const l = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, v) => { const x = clamp((v - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
  const SLOT_NAMES = ['dawn', 'day', 'golden', 'evening', 'night'];
  const root = document.documentElement;
  const clock = $('.clock');
  const day = $('#day');
  let skyT = -1;

  function setSky(t) {
    t = clamp(t, 0, 4);
    if (Math.abs(t - skyT) < 0.002) return;
    skyT = t;
    const stops = SKY[darkScheme && darkScheme.matches ? 'dark' : 'light'];
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
    const f = clamp((t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]), 0, 1);
    const top = mixRgb(rgb(stops[i][1]), rgb(stops[i + 1][1]), f);
    const bot = mixRgb(rgb(stops[i][2]), rgb(stops[i + 1][2]), f);
    const light = lum(mixRgb(top, bot, 0.55)) > 0.3;
    const st = root.style;
    st.setProperty('--sky-top', css(top));
    st.setProperty('--sky-bot', css(bot));
    st.setProperty('--ink', light ? '#1f1a2b' : '#f2f4ff');
    st.setProperty('--ink-soft', light ? 'rgba(31,26,43,0.76)' : 'rgba(242,244,255,0.8)');
    st.setProperty('--stars', smooth(2.3, 3.4, t).toFixed(3));
    st.setProperty('--clouds', (smooth(0, 0.5, t) * (1 - smooth(1.8, 2.7, t)) * 0.9 + 0.1 * (1 - smooth(2.6, 3.2, t))).toFixed(3));
    // the sun climbs from the left and sets on the right, then the moon rises
    const u = clamp(t / 2.7, 0, 1);
    st.setProperty('--sun-x', (6 + u * 86).toFixed(2) + 'vw');
    st.setProperty('--sun-y', (82 - Math.sin(u * Math.PI) * 66).toFixed(2) + 'vh');
    st.setProperty('--sun-o', (smooth(0, 0.25, t) * (1 - smooth(2.35, 2.75, t))).toFixed(3));
    // the moon keeps to the right, clear of the headings in the middle
    const m = clamp((t - 2.6) / 1.6, 0, 1);
    st.setProperty('--moon-x', (74 + m * 13).toFixed(2) + 'vw');
    st.setProperty('--moon-y', (88 - Math.sin(m * Math.PI * 0.62) * 70).toFixed(2) + 'vh');
    st.setProperty('--moon-o', smooth(2.6, 3.1, t).toFixed(3));
    if (clock) {
      const name = SLOT_NAMES[clamp(Math.round(t), 0, 4)];
      const label = $('span', clock);
      if (data.periods && label.textContent !== data.periods[name]) label.textContent = data.periods[name];
      clock.classList.toggle('night', t >= 2.75);
    }
  }

  // the visitor's clock as a time of day (0 dawn, 1 day, 2 golden hour, 3 evening, 4 night)
  function clockT() {
    const d = new Date();
    const h = d.getHours() + d.getMinutes() / 60;
    const pts = [[0, 4], [5, 4], [5.6, 0], [7, 0], [9, 1], [15.5, 1], [17, 2], [18.4, 2], [19.4, 3], [20.4, 3], [21.4, 4], [24, 4]];
    for (let k = 1; k < pts.length; k++) {
      if (h <= pts[k][0]) {
        const [h0, t0] = pts[k - 1];
        const [h1, t1] = pts[k];
        return t0 + (t1 - t0) * ((h - h0) / (h1 - h0 || 1));
      }
    }
    return 4;
  }

  function scrollT() {
    const top = day.getBoundingClientRect().top + window.scrollY;
    const start = top - innerHeight * 0.65;
    const end = Math.max(start + 1, document.documentElement.scrollHeight - innerHeight - 40);
    return ((window.scrollY - start) / (end - start)) * 4;
  }

  // ---------------------------------------------------------------- things that move with the scroll
  const zoom = $('#viewer-zoom');
  const zoomPics = $('#viewer-pics');
  const closingPic = $('#closing-pic');
  const ease = (x) => 1 - Math.pow(1 - x, 3);

  function onScroll() {
    if (day) {
      setSky(scrollT());
      if (clock) clock.classList.toggle('on', day.getBoundingClientRect().top < innerHeight * 0.5);
    }
    if (reduceMotion) return;
    if (zoom) {
      const r = zoom.getBoundingClientRect();
      const p = ease(clamp((innerHeight - r.top) / (innerHeight * 0.8), 0, 1));
      zoom.style.setProperty('--z', (0.82 + 0.18 * p).toFixed(4));
      if (zoomPics) zoomPics.style.setProperty('--zi', (1.25 - 0.25 * p).toFixed(4));
    }
    if (closingPic) {
      const r = closingPic.getBoundingClientRect();
      const p = ease(clamp((innerHeight - r.top) / (innerHeight + r.height * 0.5), 0, 1));
      closingPic.style.setProperty('--cz', (1.32 - 0.32 * p).toFixed(4));
    }
  }

  let ticking = false;
  const requestScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; onScroll(); });
  };
  window.addEventListener('scroll', requestScroll, { passive: true });
  window.addEventListener('resize', requestScroll, { passive: true });
  if (darkScheme && darkScheme.addEventListener) {
    darkScheme.addEventListener('change', () => { skyT = -1; if (day) onScroll(); else setSky(clockT()); });
  }
  if (!day) {
    setSky(clockT());
    if (clock) clock.classList.add('on');
    setInterval(() => setSky(clockT()), 60000);
  }
  onScroll();

  // ---------------------------------------------------------------- the Settings window's little controls
  const settingsWin = $('.settings-win');
  if (settingsWin && !reduceMotion) {
    const dots = $$('.ctl-colors .dot', settingsWin);
    const hello = $('.hello-track', settingsWin);
    const helloCount = hello ? hello.children.length - 1 : 0;
    const trayGlyphs = $$('.tray-glyphs .glyph', settingsWin);
    let step = 0;
    let timer = 0;
    const tick = () => {
      step++;
      dots.forEach((d, k) => d.classList.toggle('on', k === step % dots.length));
      trayGlyphs.forEach((g, k) => g.classList.toggle('on', k === step % trayGlyphs.length));
      if (hello) {
        const k = step % (helloCount + 1);
        hello.style.transition = '';
        hello.style.transform = `translateY(${-30 * k}px)`;
        if (k === helloCount) {
          // the last line repeats the first: jump back without anyone noticing
          setTimeout(() => {
            hello.style.transition = 'none';
            hello.style.transform = 'translateY(0)';
            step += 1;
          }, 700);
        }
      }
    };
    tick();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        const on = entries.some((e) => e.isIntersecting);
        clearInterval(timer);
        if (on) timer = setInterval(tick, 1700);
      }).observe(settingsWin);
    }
  }

  // ---------------------------------------------------------------- scene viewer
  const SLOTS = ['dawn', 'day', 'golden', 'evening', 'night'];
  const viewer = $('.viewer');
  if (viewer && data.scenes) {
    const imgs = $$('#viewer-pics img');
    const range = $('#time');
    const tabs = $$('.scene-tab');
    const periods = $$('.periods span');
    let index = 0;
    let t = Number(range.value);
    const src = (i, slot) => `${data.sceneBase}${data.scenes[i].scene}/${slot}-${viewer.clientWidth * (window.devicePixelRatio || 1) > 800 ? 1920 : 720}.webp`;
    const setSrc = (img, url) => { if (img.getAttribute('src') !== url) img.src = url; };

    // Start at the visitor's own time of day.
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    const now = h >= 5.5 && h < 8 ? 0 : h >= 8 && h < 16.5 ? 1 : h >= 16.5 && h < 18.6 ? 2 : h >= 18.6 && h < 20.8 ? 3 : 4;
    t = now;
    range.value = String(now);

    function render() {
      const i = Math.min(4, Math.floor(t));
      const f = t - i;
      setSrc(imgs[0], src(index, SLOTS[i]));
      setSrc(imgs[1], src(index, SLOTS[Math.min(4, i + 1)]));
      imgs[1].style.opacity = String(f);
      periods.forEach((p, k) => p.classList.toggle('on', Math.round(t) === k));
    }

    const loaded = new Set();
    function preload(i) {
      if (loaded.has(i)) return Promise.resolve();
      loaded.add(i);
      return Promise.all(SLOTS.map((slot) => new Promise((done) => {
        const im = new Image();
        im.onload = im.onerror = done;
        im.src = src(i, slot);
      })));
    }

    async function pick(i) {
      if (i === index) return;
      index = i;
      tabs.forEach((tab, k) => tab.setAttribute('aria-selected', String(k === i)));
      viewer.classList.add('switching');
      await Promise.race([preload(i), new Promise((r) => setTimeout(r, 1200))]);
      const sc = data.scenes[i];
      $('#viewer-name').textContent = sc.name;
      const bar = $('#viewer-bar');
      if (bar) bar.textContent = sc.name;
      $('#viewer-about').textContent = sc.about;
      const w = $('#viewer-weather');
      w.querySelector('svg').innerHTML = data.glyphs[sc.weather];
      w.querySelector('span').textContent = fill(data.goesWith, { weather: sc.weather && data.weatherNames[sc.weather] });
      render();
      requestAnimationFrame(() => viewer.classList.remove('switching'));
    }

    range.addEventListener('input', () => { t = Number(range.value); render(); });
    periods.forEach((p, k) => p.addEventListener('click', () => { t = k; range.value = String(k); render(); }));
    tabs.forEach((tab, k) => tab.addEventListener('click', () => pick(k)));

    // Load the pictures only when the viewer comes close.
    const start = () => { render(); preload(index); };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
      }, { rootMargin: '400px 0px' });
      io.observe(viewer);
    } else {
      start();
    }
  }
})();
