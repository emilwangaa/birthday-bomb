(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const KEY_SETTINGS = 'bomb.settings.v1';
  const KEY_STATE = 'bomb.state.v1';

  const DEFAULTS = {
    minutes: 2,
    penalty: 30,
    code: 'KAGE',
    wire: 'RØDE',
    pin: '1234',
    sound: true,
    showLetters: true,
  };

  const WIRE_COLORS = {
    'RØDE': '#d11', 'BLÅ': '#14d', 'GRØNNE': '#1a3',
    'GULE': '#ca0', 'HVIDE': '#eee', 'SORTE': '#000',
  };

  let settings = Object.assign({}, DEFAULTS, load(KEY_SETTINGS));
  // state: phase = ready | run | paused | reveal | boom
  let state = Object.assign({ phase: 'ready', endTime: 0, remainingMs: 0 }, load(KEY_STATE));
  let lastBeepKey = null;
  let wakeLock = null;
  let revealTimers = [];

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; }
  }
  function store(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* lager utilgængeligt */ }
  }
  function saveSettings() { store(KEY_SETTINGS, settings); }
  function saveState() { store(KEY_STATE, state); }

  /* ---------- Lyd ---------- */
  let ctx = null;
  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type, vol, delay) {
    if (!settings.sound) return;
    const c = audio();
    if (!c) return;
    const t = c.currentTime + (delay || 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol) {
    if (!settings.sound) return;
    const c = audio();
    if (!c) return;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource();
    const g = c.createGain();
    g.gain.value = vol || 0.6;
    s.buffer = buf; s.connect(g); g.connect(c.destination);
    s.start();
  }
  const sounds = {
    beep: () => tone(880, 0.08, 'square', 0.12),
    beepFast: () => tone(1100, 0.07, 'square', 0.15),
    alarm: () => { tone(1500, 0.12, 'sawtooth', 0.18); tone(1000, 0.12, 'sawtooth', 0.18, 0.13); },
    wrong: () => { tone(160, 0.4, 'sawtooth', 0.25); tone(120, 0.4, 'sawtooth', 0.25, 0.2); },
    boom: () => { noise(1.6, 0.8); tone(60, 1.4, 'sine', 0.5); },
    scan: () => tone(600 + Math.random() * 600, 0.05, 'sine', 0.1),
    ok: () => tone(660, 0.12, 'triangle', 0.2),
    fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.22, i * 0.15)),
  };

  /* ---------- Hjælp ---------- */
  function fmt(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function norm(s) { return String(s).replace(/\s+/g, '').toUpperCase(); }
  function remaining() {
    if (state.phase === 'run') return state.endTime - Date.now();
    return state.remainingMs || 0;
  }
  function show(name) {
    ['ready', 'run', 'reveal', 'boom'].forEach((n) => $('screen-' + n).classList.toggle('hidden', n !== name));
  }
  function clearRevealTimers() { revealTimers.forEach(clearTimeout); revealTimers = []; }

  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* ikke understøttet */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.phase === 'run') keepAwake();
  });

  function renderLetters() {
    const el = $('hintLetters');
    if (settings.showLetters) {
      el.textContent = Array.from(norm(settings.code)).map(() => '_').join(' ');
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  /* ---------- Faser ---------- */
  function render() {
    clearRevealTimers();
    document.body.classList.remove('urgent');
    $('status').textContent = '';
    if (state.phase === 'ready') {
      show('ready');
    } else if (state.phase === 'run' || state.phase === 'paused') {
      show('run');
      renderLetters();
      $('clock').textContent = fmt(remaining());
      $('status').textContent = state.phase === 'paused' ? 'PAUSE' : '';
      $('a-pause').textContent = state.phase === 'paused' ? 'Fortsæt' : 'Pause';
      if (state.phase === 'run') keepAwake();
    } else if (state.phase === 'reveal') {
      show('reveal');
      $('clockFrozen').textContent = fmt(state.remainingMs);
      runReveal(true);
    } else if (state.phase === 'boom') {
      show('boom');
    }
  }

  function startGame() {
    audio();
    state = { phase: 'run', endTime: Date.now() + settings.minutes * 60000, remainingMs: 0 };
    lastBeepKey = null;
    saveState(); render();
  }

  function setPhase(phase, extra) {
    state = Object.assign({}, state, { phase }, extra || {});
    saveState(); render();
  }

  function doBoom() {
    document.body.classList.add('flash');
    setTimeout(() => document.body.classList.remove('flash'), 700);
    sounds.boom();
    setPhase('boom', { remainingMs: 0 });
  }

  function addTime(ms) {
    if (state.phase === 'run') {
      state.endTime += ms;
    } else if (state.phase === 'paused') {
      state.remainingMs += ms;
    } else if (state.phase === 'boom' || state.phase === 'reveal') {
      state = { phase: 'run', endTime: Date.now() + ms, remainingMs: 0 };
    } else {
      return;
    }
    lastBeepKey = null;
    saveState(); render();
  }

  function submitCode() {
    if (state.phase !== 'run') return;
    const input = $('code');
    const guess = norm(input.value);
    if (!guess) return;
    if (guess === norm(settings.code)) {
      input.value = '';
      input.blur();
      setPhase('reveal', { remainingMs: Math.max(0, remaining()) });
    } else {
      sounds.wrong();
      input.value = '';
      document.body.classList.add('shake');
      setTimeout(() => document.body.classList.remove('shake'), 600);
      if (settings.penalty > 0) {
        state.endTime -= settings.penalty * 1000;
        saveState();
        $('status').textContent = 'FORKERT KODE! −' + settings.penalty + ' sek';
      } else {
        $('status').textContent = 'FORKERT KODE! Prøv igen';
      }
      if (remaining() <= 0) doBoom();
    }
  }

  function runReveal(quick) {
    const text = $('revealText');
    const wire = $('wire');
    wire.className = 'wire hidden';
    text.textContent = '';
    const wireName = settings.wire;
    const yarn = $('yarnReveal');
    yarn.classList.remove('done');
    yarn.style.removeProperty('--yarn');
    const steps = [
      [0, () => { text.textContent = 'KODE ACCEPTERET…'; sounds.ok(); }],
      [1800, () => {
        text.textContent = 'Analyserer ledninger…';
        for (let i = 0; i < 12; i++) revealTimers.push(setTimeout(sounds.scan, i * 220));
      }],
      [4800, () => { text.textContent = 'KLIP DEN…'; sounds.ok(); }],
      [6800, () => {
        text.textContent = 'Klip over på den…';
        wire.textContent = wireName + ' LEDNING!';
        wire.className = 'wire ' + wireName;
        yarn.style.setProperty('--yarn', WIRE_COLORS[wireName] || '#d11');
        yarn.classList.add('done');
        sounds.fanfare();
      }],
    ];
    steps.forEach(([t, fn]) => revealTimers.push(setTimeout(fn, quick ? t / 2 : t)));
  }

  /* ---------- Tik ---------- */
  function tick() {
    if (state.phase !== 'run') return;
    const ms = remaining();
    if (ms <= 0) { doBoom(); return; }
    $('clock').textContent = fmt(ms);
    const secs = Math.ceil(ms / 1000);
    $('clock').classList.toggle('urgent', secs <= 60);
    document.body.classList.toggle('urgent', secs <= 60);
    // beep-nøgle: skifter når et beep skal lyde
    const fast = secs <= 60;
    const key = fast ? Math.floor(ms / 500) : Math.floor(ms / 1000);
    if (key !== lastBeepKey) {
      lastBeepKey = key;
      if (secs <= 10) sounds.alarm();
      else if (fast) sounds.beepFast();
      else sounds.beep();
    }
  }
  setInterval(tick, 100);

  /* ---------- Voksen-menu ---------- */
  let pressTimer = null;
  const title = $('title');
  const lamp = $('lamp');
  [title, lamp].forEach((el) => {
    el.addEventListener('pointerdown', () => {
      clearTimeout(pressTimer);
      pressTimer = setTimeout(openPin, 3000);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
      el.addEventListener(ev, () => clearTimeout(pressTimer)));
  });

  // 5 hurtige tryk på lampen (inden for 3 sek) åbner menuen — nemt på touch
  let taps = [];
  lamp.addEventListener('pointerdown', () => {
    const now = Date.now();
    taps = taps.filter((t) => now - t < 3000);
    taps.push(now);
    if (taps.length >= 5) { taps = []; openPin(); }
  });

  // Tastaturgenvej på computer: F2 eller Ctrl+Alt+A
  document.addEventListener('keydown', (e) => {
    const isShortcut = e.key === 'F2' || (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'a');
    if (isShortcut) {
      e.preventDefault();
      if ($('pin-dialog').classList.contains('hidden') && $('admin').classList.contains('hidden')) openPin();
    } else if (e.key === 'Escape') {
      $('pin-dialog').classList.add('hidden');
    }
  });

  function openPin() {
    $('pin').value = '';
    $('pin-error').textContent = '';
    $('pin-dialog').classList.remove('hidden');
    setTimeout(() => $('pin').focus(), 50);
  }
  $('pin-cancel').onclick = () => $('pin-dialog').classList.add('hidden');
  function checkPin() {
    if ($('pin').value === settings.pin) {
      $('pin-dialog').classList.add('hidden');
      openAdmin();
    } else {
      $('pin-error').textContent = 'Forkert PIN';
    }
  }
  $('pin-ok').onclick = checkPin;
  $('pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') checkPin(); });

  function openAdmin() {
    $('s-minutes').value = settings.minutes;
    $('s-penalty').value = settings.penalty;
    $('s-code').value = settings.code;
    $('s-wire').value = settings.wire;
    $('s-pin').value = settings.pin;
    $('s-sound').checked = settings.sound;
    $('s-letters').checked = settings.showLetters;
    $('a-pause').textContent = state.phase === 'paused' ? 'Fortsæt' : 'Pause';
    $('admin').classList.remove('hidden');
  }
  function closeAdmin() {
    const minutes = parseInt($('s-minutes').value, 10);
    const penalty = parseInt($('s-penalty').value, 10);
    settings.minutes = minutes > 0 ? minutes : DEFAULTS.minutes;
    settings.penalty = penalty >= 0 ? penalty : DEFAULTS.penalty;
    settings.code = norm($('s-code').value) || DEFAULTS.code;
    settings.wire = $('s-wire').value;
    settings.pin = $('s-pin').value.trim() || DEFAULTS.pin;
    settings.sound = $('s-sound').checked;
    settings.showLetters = $('s-letters').checked;
    saveSettings();
    $('admin').classList.add('hidden');
    renderLetters();
    // Nulstillet spil bruger de nye indstillinger ved næste start.
  }
  $('a-close').onclick = closeAdmin;
  $('a-plus1').onclick = () => addTime(60000);
  $('a-plus5').onclick = () => addTime(300000);
  $('a-pause').onclick = () => {
    if (state.phase === 'run') {
      setPhase('paused', { remainingMs: Math.max(0, remaining()) });
    } else if (state.phase === 'paused') {
      setPhase('run', { endTime: Date.now() + state.remainingMs });
    }
    $('a-pause').textContent = state.phase === 'paused' ? 'Fortsæt' : 'Pause';
  };
  $('a-reset').onclick = () => {
    if (!confirm('Nulstil spillet?')) return;
    setPhase('ready', { endTime: 0, remainingMs: 0 });
    $('admin').classList.add('hidden');
  };

  /* ---------- Knapper ---------- */
  $('btn-start').onclick = startGame;
  $('btn-defuse').onclick = submitCode;
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitCode(); });

  // Hvis siden genindlæses efter tiden er gået
  if (state.phase === 'run' && remaining() <= 0) state = { phase: 'boom', endTime: 0, remainingMs: 0 };
  render();
})();
