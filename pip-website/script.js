/* =========================================================
   PIPS WEBSIT — all da magic
   no libraries. just crayons (and the Web Audio API).
   ========================================================= */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  // localStorage can throw (private mode, blocked storage) — never let that break the page
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('pip:' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('pip:' + key, JSON.stringify(value)); } catch { /* ok */ }
    },
  };

  /* ---------------------------------------------------------
     SOUND — everything is synthesized, no audio files
     --------------------------------------------------------- */
  const Sound = (() => {
    let ctx = null;
    let master = null;
    let unlocked = false; // only start audio after a real user gesture
    let muted = store.get('muted', false);

    function ac() {
      if (!unlocked) return null;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function tone({ freq = 440, to, type = 'sine', dur = 0.15, vol = 0.3, delay = 0, attack = 0.005 }) {
      if (muted) return;
      const c = ac();
      if (!c) return;
      const t = c.currentTime + delay;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    function noise({ delay = 0, dur = 0.05, vol = 0.25, freq = 3200 }) {
      if (muted) return;
      const c = ac();
      if (!c) return;
      const t = c.currentTime + delay;
      const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = c.createBufferSource();
      const bp = c.createBiquadFilter();
      const g = c.createGain();
      src.buffer = buf;
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 1.5;
      g.gain.value = vol;
      src.connect(bp).connect(g).connect(master);
      src.start(t);
    }

    // music-box bell: fundamental + two soft overtones, long decay
    function bell(freq, delay = 0, vol = 0.22) {
      tone({ freq, dur: 1.8, vol, delay, attack: 0.003 });
      tone({ freq: freq * 2.01, dur: 0.9, vol: vol * 0.3, delay, attack: 0.003 });
      tone({ freq: freq * 3.03, dur: 0.4, vol: vol * 0.12, delay, attack: 0.002 });
    }

    return {
      unlock() { unlocked = true; },
      get ready() { return !!ctx && !muted; },
      get muted() { return muted; },
      setMuted(m) {
        muted = m;
        store.set('muted', m);
        if (ctx && master) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.02);
      },
      bell,
      click: () => tone({ freq: 520, to: 820, dur: 0.09, vol: 0.16 }),
      boop: () => tone({ freq: 700, to: 1300, type: 'triangle', dur: 0.12, vol: 0.22 }),
      bonk: () => tone({ freq: 240, to: 110, dur: 0.2, vol: 0.32 }),
      squeak: () => { tone({ freq: 900, to: 1500, type: 'triangle', dur: 0.08, vol: 0.15 }); tone({ freq: 1500, to: 1000, type: 'triangle', dur: 0.1, vol: 0.12, delay: 0.08 }); },
      rattle: () => { for (let i = 0; i < 7; i++) noise({ delay: i * 0.065 + rand(0, 0.02), freq: rand(2500, 4500), vol: 0.3 }); },
      giggle: () => { for (let i = 0; i < 6; i++) tone({ freq: 620 + i * 70, to: 900 + i * 90, type: 'triangle', dur: 0.07, vol: 0.18, delay: i * 0.09 }); },
      chime: (up = true) => { const n = up ? [784, 1175] : [1175, 784]; n.forEach((f, i) => bell(f, i * 0.09, 0.14)); },
    };
  })();

  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, Sound.unlock, { once: false, passive: true }));

  // every button gets a tiny boop (specific toys add their own sounds instead)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button, .crayon-btn');
    if (b && !b.matches('.bar, .block, .rattle, .light, #noseHit, #windBtn')) Sound.click();
  });

  /* ---------------------------------------------------------
     FX CANVAS — sparkle trail + confetti
     --------------------------------------------------------- */
  const FX = (() => {
    const canvas = $('#fx');
    const ctx = canvas.getContext('2d');
    const parts = [];
    const colors = ['#ffd166', '#ff8fab', '#8ecae6', '#c8b6ff', '#95d5b2', '#ffc861'];
    let dpr = 1;
    let running = false;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
    }
    resize();
    window.addEventListener('resize', resize);

    function star(x, y, r, rot) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? r * 0.45 : r;
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    function heart(x, y, r, rot) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(r / 10, r / 10);
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.bezierCurveTo(-10, -2, -6, -12, 0, -5);
      ctx.bezierCurveTo(6, -12, 10, -2, 0, 6);
      ctx.fill();
      ctx.restore();
    }

    function loop() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= 1;
        p.vy += p.g;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.life <= 0 || p.y > innerHeight + 40) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = Math.min(1, p.life / 25);
        ctx.fillStyle = p.color;
        (p.shape === 'heart' ? heart : star)(p.x, p.y, p.r, p.rot);
      }
      ctx.globalAlpha = 1;
      if (parts.length) requestAnimationFrame(loop);
      else running = false;
    }
    function kick() { if (!running) { running = true; requestAnimationFrame(loop); } }

    return {
      sparkle(x, y) {
        if (parts.length > 160) return;
        parts.push({ x, y, vx: rand(-0.6, 0.6), vy: rand(-0.4, 0.6), g: 0.03, r: rand(3, 6.5), rot: rand(0, 6), vr: rand(-0.1, 0.1), life: rand(26, 42), color: pick(colors), shape: 'star' });
        kick();
      },
      confetti(x = innerWidth / 2, y = innerHeight / 3, n = 120) {
        if (reduceMotion) n = Math.min(n, 24);
        for (let i = 0; i < n; i++) {
          const a = rand(0, Math.PI * 2);
          const s = rand(3, 10);
          parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 4, g: 0.18, r: rand(5, 11), rot: rand(0, 6), vr: rand(-0.2, 0.2), life: rand(70, 120), color: pick(colors), shape: Math.random() < 0.35 ? 'heart' : 'star' });
        }
        kick();
      },
    };
  })();

  /* ---------------------------------------------------------
     PIP — eyes, head tilt, blinking, napping, waving
     --------------------------------------------------------- */
  const pip = $('#pip');
  const bubble = $('#pipBubble');
  const pupils = [$('#pupilL'), $('#pupilR')];
  const sockets = [{ x: 114, y: 190 }, { x: 188, y: 186 }];
  const tiltParts = [$('#pipHead'), $('#pipCap'), $('#pupils')];

  function say(text) {
    bubble.textContent = text;
    bubble.classList.remove('pop');
    void bubble.offsetWidth; // restart the pop animation
    bubble.classList.add('pop');
  }

  // convert a screen point into Pip's SVG coordinate space
  function toPip(clientX, clientY) {
    const m = pip.getScreenCTM();
    if (!m) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return pt;
  }

  let lastPointer = null;
  let lookFrame = 0;
  function lookAt(clientX, clientY) {
    const p = toPip(clientX, clientY);
    if (!p) return;
    sockets.forEach((s, i) => {
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, dist / 160);
      pupils[i].style.transform = `translate(${(dx / dist) * 13 * reach}px, ${(dy / dist) * 15 * reach}px)`;
    });
    const tilt = reduceMotion ? 0 : clamp((p.x - 150) / 60, -7, 7);
    tiltParts.forEach((el) => { el.style.transform = `rotate(${tilt}deg)`; });
  }

  // idle → wandering eyes → nap
  let idleTimer, napTimer, wanderTimer;
  function resetIdle() {
    if (pip.classList.contains('asleep')) {
      pip.classList.remove('asleep');
      say(pick(['huh?! oh hi!!', 'i was NOT sleepin', '*yawwwn* hewwo']));
    }
    clearTimeout(idleTimer);
    clearTimeout(napTimer);
    clearInterval(wanderTimer);
    idleTimer = setTimeout(() => {
      // eyes wander around while nobody is moving
      wanderTimer = setInterval(() => {
        const r = pip.getBoundingClientRect();
        lookAt(r.left + rand(-0.2, 1.2) * r.width, r.top + rand(0, 1) * r.height);
      }, 1400);
    }, 5000);
    napTimer = setTimeout(() => {
      clearInterval(wanderTimer);
      pip.classList.add('asleep');
      say('zzz… (shhh)');
    }, 30000);
  }

  window.addEventListener('pointermove', (e) => {
    lastPointer = e;
    if (!lookFrame) {
      lookFrame = requestAnimationFrame(() => {
        lookFrame = 0;
        lookAt(lastPointer.clientX, lastPointer.clientY);
        flashlight(lastPointer.clientX, lastPointer.clientY);
      });
    }
    resetIdle();
  }, { passive: true });
  window.addEventListener('pointerdown', (e) => { lookAt(e.clientX, e.clientY); resetIdle(); }, { passive: true });
  window.addEventListener('keydown', resetIdle);
  window.addEventListener('scroll', () => { if (!pip.classList.contains('asleep')) return; resetIdle(); }, { passive: true });

  // blink every few seconds
  (function blinkLoop() {
    setTimeout(() => {
      if (!pip.classList.contains('asleep') && !pip.classList.contains('love')) {
        pip.classList.add('blink');
        setTimeout(() => pip.classList.remove('blink'), 140);
      }
      blinkLoop();
    }, rand(2600, 5600));
  })();

  function wave() {
    pip.classList.remove('waving');
    void pip.getBoundingClientRect();
    pip.classList.add('waving');
  }
  pip.addEventListener('animationend', (e) => { if (e.animationName === 'wave') pip.classList.remove('waving'); });

  const pipLines = [
    'i made dis whole websit!!', 'u hav a nice cursor', 'wanna hear a lullaby? scroll down!',
    'i am NOT scary. i am 1½', 'milk pls', 'my hat has STARS', 'boss owl sez im a good enjineer',
    'did u turn on my nite lites?', 'i can count to 3. 1, 2, 5!',
  ];
  pip.addEventListener('click', (e) => {
    if (e.target.id === 'noseHit') return;
    Sound.squeak();
    wave();
    say(pick(pipLines));
  });

  // ---- the EASTER EGG: boop the nose 5 times ----
  let boops = 0;
  let boopTimer;
  const boopLines = ['boop!', 'hehe', 'hehehe!!', 'STOP it tickls', 'HEHEHEHE—'];
  function boop() {
    boops += 1;
    Sound.boop();
    pip.classList.add('booped');
    setTimeout(() => pip.classList.remove('booped'), 160);
    say(boopLines[Math.min(boops, boopLines.length) - 1]);
    clearTimeout(boopTimer);
    boopTimer = setTimeout(() => { boops = 0; }, 3000);
    if (boops >= 5) { boops = 0; openSecret(); }
  }
  const noseHit = $('#noseHit');
  noseHit.addEventListener('click', boop);
  noseHit.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); boop(); }
  });

  const secret = $('#secret');
  let secretReturnFocus = null;
  function openSecret() {
    secretReturnFocus = document.activeElement;
    pip.classList.add('love');
    Sound.giggle();
    setTimeout(() => [523, 659, 784, 1047].forEach((f, i) => Sound.bell(f, i * 0.12, 0.16)), 450);
    FX.confetti(innerWidth / 2, innerHeight / 2, 160);
    secret.hidden = false;
    $('#secretClose').focus();
    store.set('bestFren', true);
  }
  function closeSecret() {
    secret.hidden = true;
    pip.classList.remove('love');
    say('ur my bestest fren now ♥');
    if (secretReturnFocus && secretReturnFocus.focus) secretReturnFocus.focus();
  }
  $('#secretClose').addEventListener('click', closeSecret);
  secret.addEventListener('click', (e) => { if (e.target === secret) closeSecret(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !secret.hidden) closeSecret(); });

  // psst: typing "pip" anywhere also works (keyboard-friendly way to find the egg)
  let typed = '';
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    typed = (typed + e.key.toLowerCase()).slice(-3);
    if (typed === 'pip' && secret.hidden) openSecret();
  });

  /* ---------------------------------------------------------
     SPARKLE TRAIL (fine pointers only, so phones stay fast)
     --------------------------------------------------------- */
  if (finePointer && !reduceMotion) {
    let last = 0;
    window.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (now - last < 28) return;
      last = now;
      FX.sparkle(e.clientX + rand(-4, 4), e.clientY + rand(-4, 4));
    }, { passive: true });
  }

  /* ---------------------------------------------------------
     TOGGLES — sound, nap time, chaos
     --------------------------------------------------------- */
  const root = document.documentElement;
  const soundBtn = $('#soundBtn');
  function renderSound() {
    const on = !Sound.muted;
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.setAttribute('aria-label', on ? 'Sound on. Click to mute' : 'Sound off. Click to unmute');
    $('.t-icon', soundBtn).textContent = on ? '🔊' : '🔇';
    $('.t-label', soundBtn).textContent = on ? 'sound' : 'shhh';
  }
  soundBtn.addEventListener('click', () => {
    Sound.setMuted(!Sound.muted);
    renderSound();
    if (Sound.muted) stopLullaby();
    say(Sound.muted ? 'ok i will be qwiet. 🤫' : 'yay noises!!');
  });
  renderSound();

  const napBtn = $('#napBtn');
  const flash = $('#flashlight');
  function setTheme(theme, announce) {
    const night = theme === 'night';
    root.dataset.theme = theme;
    napBtn.setAttribute('aria-pressed', String(night));
    napBtn.setAttribute('aria-label', night ? 'Switch to play time (light mode)' : 'Switch to nap time (dark mode)');
    $('.t-icon', napBtn).textContent = night ? '☀️' : '🌙';
    $('.t-label', napBtn).textContent = night ? 'play time' : 'nap time';
    $('meta[name="theme-color"]').setAttribute('content', night ? '#17163a' : '#fff8f1');
    flash.classList.toggle('on', night && finePointer && !reduceMotion);
    store.set('theme', theme);
    if (announce) {
      say(night ? 'nite time is my WERK time! 🔦' : 'gud morning!! ☀️');
      Sound.chime(!night);
    }
  }
  function flashlight(x, y) {
    flash.style.setProperty('--fx', x + 'px');
    flash.style.setProperty('--fy', y + 'px');
  }
  napBtn.addEventListener('click', () => setTheme(root.dataset.theme === 'night' ? 'day' : 'night', true));
  setTheme(store.get('theme', 'day'), false);

  const chaosBtn = $('#chaosBtn');
  chaosBtn.addEventListener('click', () => {
    const on = !root.classList.contains('chaos');
    root.classList.toggle('chaos', on);
    chaosBtn.setAttribute('aria-pressed', String(on));
    if (on) {
      $$('.paper, .polaroid').forEach((el) => el.style.setProperty('--chaos-r', rand(-4, 4).toFixed(1) + 'deg'));
      Sound.giggle();
      say('I GOT ALL DA CRAYONS!!!');
      FX.confetti(innerWidth / 2, 80, 60);
    } else {
      say('ok ok. i put dem bak.');
    }
  });

  /* ---------------------------------------------------------
     PROJECT 1 — LULLABY LAB
     --------------------------------------------------------- */
  // C major, music-box register
  const SCALE = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77, 1046.5];
  const PENTA = [0, 1, 2, 4, 5, 7]; // indexes into SCALE (C D E G A C')
  const box = $('.musicbox');
  const notesEl = $('#notes');
  const windBtn = $('#windBtn');
  const lullabyStatus = $('#lullabyStatus');
  let lullabyTimers = [];

  function floatNote() {
    if (reduceMotion) return;
    const n = document.createElement('span');
    n.className = 'note-fly';
    n.textContent = pick(['♪', '♫', '★', '♩']);
    n.style.left = rand(25, 70) + '%';
    n.style.setProperty('--dx', rand(-60, 60) + 'px');
    n.style.setProperty('--rot', rand(-40, 40) + 'deg');
    notesEl.appendChild(n);
    n.addEventListener('animationend', () => n.remove());
  }

  function stopLullaby() {
    lullabyTimers.forEach(clearTimeout);
    lullabyTimers = [];
    box.classList.remove('playing');
    windBtn.disabled = false;
  }

  // a new little lullaby every time: gentle random walk on the pentatonic scale, in 3/4
  function playLullaby() {
    stopLullaby();
    if (Sound.muted) {
      lullabyStatus.textContent = 'sound is off! tap 🔇 up top to hear it.';
      say('i cant sing if u shhh me 🤫');
      return;
    }
    const beat = 0.48;
    let idx = 2;
    const melody = [];
    for (let i = 0; i < 18; i++) {
      idx = clamp(idx + pick([-2, -1, -1, 0, 1, 1, 2]), 0, PENTA.length - 1);
      melody.push(SCALE[PENTA[idx]]);
    }
    melody.push(SCALE[0]); // always land home
    box.classList.add('playing');
    windBtn.disabled = true;
    lullabyStatus.textContent = 'shhh… lisening…';
    say('dis one is called “' + pick(['sleepy socks', 'moon soup', 'blanket fort', 'owl hugs', 'tiny yawn']) + '”');
    melody.forEach((f, i) => {
      const long = i === melody.length - 1;
      Sound.bell(f, i * beat, long ? 0.26 : 0.2);
      if (i % 3 === 0) Sound.bell(f / 2, i * beat, 0.08); // soft bass on beat one
      lullabyTimers.push(setTimeout(floatNote, i * beat * 1000));
    });
    lullabyTimers.push(setTimeout(() => {
      stopLullaby();
      lullabyStatus.textContent = 'did u get sleepy? wind it agen for a new one!';
    }, melody.length * beat * 1000 + 1200));
  }
  windBtn.addEventListener('click', playLullaby);

  const bars = $$('.bar');
  function hitBar(i) {
    const bar = bars[i];
    if (!bar) return;
    Sound.bell(SCALE[i], 0, 0.28);
    floatNote();
    bar.classList.add('hit');
    setTimeout(() => bar.classList.remove('hit'), 120);
  }
  bars.forEach((bar, i) => bar.addEventListener('click', () => hitBar(i)));
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea') || e.repeat) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 8) hitBar(n - 1);
  });

  /* ---------------------------------------------------------
     PROJECT 2 — NIGHTLIGHTS
     --------------------------------------------------------- */
  const lights = $$('.light');
  const lightCount = $('#lightCount');
  lights.forEach((btn) => btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    Sound.chime(on);
    const count = lights.filter((l) => l.getAttribute('aria-pressed') === 'true').length;
    lightCount.textContent = count === lights.length ? `${count} / ${count} on — so cozy!! ✨` : `${count} / ${lights.length} on`;
    if (on && count === lights.length) {
      const r = btn.getBoundingClientRect();
      FX.confetti(r.left + r.width / 2, r.top + r.height / 2, 50);
      say('all my nite lites r on!! no more scary dark');
    }
  }));

  /* ---------------------------------------------------------
     PROJECT 3 — BLOCKS & RATTLE
     --------------------------------------------------------- */
  const playpen = $('#playpen');
  $$('.block', playpen).forEach((block) => {
    let drag = null;
    const setPos = (xPct, yPct) => {
      const maxX = 100 - (block.offsetWidth / playpen.clientWidth) * 100;
      const maxY = 100 - (block.offsetHeight / playpen.clientHeight) * 100;
      block.style.setProperty('--x', clamp(xPct, 0, maxX) + '%');
      block.style.setProperty('--y', clamp(yPct, 0, maxY) + '%');
    };
    block.addEventListener('pointerdown', (e) => {
      const r = block.getBoundingClientRect();
      drag = { ox: e.clientX - r.left, oy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
      block.setPointerCapture(e.pointerId);
      block.classList.add('dragging');
      playpen.appendChild(block); // bring to front
    });
    block.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
      const pr = playpen.getBoundingClientRect();
      setPos(((e.clientX - pr.left - drag.ox) / pr.width) * 100, ((e.clientY - pr.top - drag.oy) / pr.height) * 100);
    });
    const end = () => {
      if (!drag) return;
      block.classList.remove('dragging');
      if (drag.moved) Sound.bonk(); else Sound.squeak();
      drag = null;
    };
    block.addEventListener('pointerup', end);
    block.addEventListener('pointercancel', end);
    block.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -6], ArrowDown: [0, 6] }[e.key];
      if (!step) return;
      e.preventDefault();
      const x = parseFloat(block.style.getPropertyValue('--x') || getComputedStyle(block).getPropertyValue('--x'));
      const y = parseFloat(block.style.getPropertyValue('--y') || getComputedStyle(block).getPropertyValue('--y'));
      setPos(x + step[0], y + step[1]);
      Sound.bonk();
    });
  });
  const rattle = $('#rattle');
  rattle.addEventListener('click', () => {
    rattle.classList.remove('shake');
    void rattle.offsetWidth;
    rattle.classList.add('shake');
    Sound.rattle();
  });
  rattle.addEventListener('animationend', () => rattle.classList.remove('shake'));

  /* ---------------------------------------------------------
     PROJECT 4 — DREAM DELIVERY (scroll-synced SVG route)
     PROJECT 5 — growth chart animation
     STORY — sticky scroll scenes
     --------------------------------------------------------- */
  const map = $('#map');
  const route = $('#route');
  const flyer = $('#flyer');
  const houses = $$('.house', map);
  const deliveredEl = $('#deliveredCount');
  const routeLen = route.getTotalLength();
  route.style.strokeDasharray = routeLen;
  route.style.strokeDashoffset = routeLen;
  // find how far along the route each chimney sits
  const chimneyX = [111, 269, 404, 557, 691];
  const houseAt = chimneyX.map((cx) => {
    for (let l = 0; l <= routeLen; l += 2) if (route.getPointAtLength(l).x >= cx) return l / routeLen;
    return 1;
  });
  let delivered = 0;

  const story = $('#story');
  const sceneArts = $$('.scene-art', story);
  const sceneTexts = $$('.scene-text', story);
  const dots = $$('.story-dots li', story);
  let currentScene = -1;

  function onScroll() {
    const vh = innerHeight;

    // dream delivery
    const mr = map.getBoundingClientRect();
    const start = vh * 0.9;
    const end = vh * 0.3;
    const p = clamp((start - mr.top) / (start - end + mr.height * 0.4), 0, 1);
    route.style.strokeDashoffset = routeLen * (1 - p);
    const pt = route.getPointAtLength(routeLen * p);
    flyer.setAttribute('transform', `translate(${pt.x} ${pt.y - 18})`);
    let lit = 0;
    houses.forEach((h, i) => {
      const on = p >= houseAt[i] - 0.005;
      if (on) lit++;
      h.classList.toggle('lit', on);
    });
    if (lit !== delivered) {
      if (lit > delivered && Sound.ready) Sound.bell(SCALE[PENTA[Math.min(lit, PENTA.length - 1)]], 0, 0.12);
      delivered = lit;
      deliveredEl.textContent = lit === houses.length ? `${lit} / ${lit} dreems deliverd!! 🎉` : `${lit} / ${houses.length} dreems deliverd`;
    }

    // story
    const sr = story.getBoundingClientRect();
    const sp = clamp(-sr.top / (sr.height - vh), 0, 1);
    story.style.setProperty('--p', sp.toFixed(3));
    story.dataset.dark = String(sp > 0.4);
    const scene = Math.min(sceneTexts.length - 1, Math.floor(sp * sceneTexts.length));
    if (scene !== currentScene) {
      currentScene = scene;
      [sceneArts, sceneTexts, dots].forEach((list) => list.forEach((el, i) => el.classList.toggle('active', i === scene)));
    }
  }
  let scrollFrame = 0;
  window.addEventListener('scroll', () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; onScroll(); });
  }, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      if (en.target.matches('.growth')) en.target.classList.add('grow');
      if (en.target.matches('#odometer')) spinOdometer();
      io.unobserve(en.target);
    });
  }, { threshold: 0.4 });
  io.observe($('.growth'));

  /* ---------------------------------------------------------
     GUESTBOOK (remembers you in this browser)
     --------------------------------------------------------- */
  const seed = [
    { name: 'Mama', msg: 'so proud of my littel dream engineer ♥ (i fixed one spelling. pip un-fixed it.)', sticker: '🍼' },
    { name: 'Boss Owl', msg: 'Excellent nightlight work this week, Pip. Hoo-ray.', sticker: '⭐' },
    { name: 'da Moon', msg: 'thank u for da lullaby. i slept 12 hours.', sticker: '🌙' },
  ];
  const notes = ['#fff3b0', '#ffd6e6', '#d6f0ff', '#e2f7d9', '#ece4ff'];
  const gbList = $('#gbList');
  const gbForm = $('#gbForm');
  let entries = store.get('guestbook', []);
  if (!Array.isArray(entries)) entries = [];

  function renderGuestbook() {
    gbList.textContent = '';
    [...entries, ...seed].forEach((en, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--note', notes[i % notes.length]);
      li.style.setProperty('--r', (i % 2 ? 2 : -2) + rand(-1, 1) + 'deg');
      const stk = document.createElement('span');
      stk.className = 'stk';
      stk.setAttribute('aria-hidden', 'true');
      stk.textContent = en.sticker;
      const b = document.createElement('b');
      b.textContent = en.name;
      const p = document.createElement('p');
      p.textContent = en.msg;
      li.append(stk, b, p);
      gbList.appendChild(li);
    });
  }
  gbForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(gbForm);
    const name = String(data.get('name') || '').trim().slice(0, 24);
    const msg = String(data.get('msg') || '').trim().slice(0, 140);
    if (!name || !msg) { say('u forgot to rite sumfing!'); return; }
    entries = [{ name, msg, sticker: String(data.get('sticker') || '🌙') }, ...entries].slice(0, 30);
    store.set('guestbook', entries);
    store.set('friend', name);
    renderGuestbook();
    gbForm.reset();
    Sound.giggle();
    const r = gbList.getBoundingClientRect();
    FX.confetti(r.left + 100, r.top + 40, 60);
    say(`yay ${name} sined my book!!`);
  });
  renderGuestbook();

  /* ---------------------------------------------------------
     HIT COUNTER (odometer)
     --------------------------------------------------------- */
  const odometer = $('#odometer');
  let visits = store.get('visits', 0);
  try {
    if (!sessionStorage.getItem('pip:counted')) {
      visits += 1;
      store.set('visits', visits);
      sessionStorage.setItem('pip:counted', '1');
    }
  } catch { visits = Math.max(visits, 1); }
  const hitNumber = String(1336 + visits).padStart(6, '0');
  odometer.setAttribute('aria-label', String(Number(hitNumber)));
  [...hitNumber].forEach(() => {
    const d = document.createElement('span');
    d.className = 'odo-digit';
    const col = document.createElement('span');
    col.className = 'odo-col';
    for (let n = 0; n <= 9; n++) { const s = document.createElement('span'); s.textContent = n; col.appendChild(s); }
    d.appendChild(col);
    odometer.appendChild(d);
  });
  function spinOdometer() {
    $$('.odo-col', odometer).forEach((col, i) => {
      col.style.transitionDelay = i * 0.12 + 's';
      col.style.transform = `translateY(-${Number(hitNumber[i]) * 1.3}em)`;
    });
  }
  io.observe(odometer);

  $('#footerMoon').addEventListener('click', () => {
    [784, 659, 523].forEach((f, i) => Sound.bell(f, i * 0.3, 0.18));
    say('nite nite, moon 🌙');
  });

  /* ---------------------------------------------------------
     HELLO!
     --------------------------------------------------------- */
  const friend = store.get('friend', null);
  if (store.get('bestFren', false)) say(`hi bestest fren${friend ? ' ' + friend : ''}!! ♥`);
  else if (friend) say(`welcum bak ${friend}!! i remember u`);
  else say('hewwo!! 👋 i made dis');
  setTimeout(wave, 600);
  resetIdle();

  console.log('%c hi grownup 👋 pip here. try booping my nose. (or just type p-i-p)', 'font: 16px Gaegu, cursive; color: #a34063');
})();
