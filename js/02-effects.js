/* 02-effects.js - efectos ambientales: reproductor de audio flotante y campo
   de flujo (canvas de particulas).

   Aqui vivia tambien un cursor personalizado (un anillo que seguia al raton con
   suavizado y crecia al pasar por encima de lo clicable). Se retiro a peticion
   expresa: el sitio usa el puntero normal del sistema. Al quitarlo desaparecio
   con el tambien `window.bindHover`, que solo existia para engancharle los
   estados de hover, y las reglas CSS que lo ocultaban dentro de la paleta y del
   grafo, que ya no tenian nada que contrarrestar. */

/* ============ AUDIO PLAYER WIDGET ============ */
(function() {
  const player = document.getElementById('audio-player');
  const audio = document.getElementById('audio-el');
  const playBtn = document.getElementById('audio-play');
  const playIcon = document.getElementById('audio-play-icon');
  const pauseIcon = document.getElementById('audio-pause-icon');
  const slider = document.getElementById('audio-slider');
  const progress = document.getElementById('audio-progress');
  const currentEl = document.getElementById('audio-current');
  const durationEl = document.getElementById('audio-duration');
  const shuffleBtn = document.getElementById('audio-shuffle');
  const repeatBtn = document.getElementById('audio-repeat');
  const minimizeBtn = document.getElementById('audio-minimize');
  const expandBtn = document.getElementById('audio-expand');
  if (!player || !audio) return;

  let isPlaying = false;
  let isShuffle = false;
  let isRepeat = false;

  // Restore preferences
  const prefs = JSON.parse(localStorage.getItem('jdh_audioPrefs') || '{}');
  if (prefs.minimized) {
    player.classList.add('collapsed');
    expandBtn.classList.add('visible');
  }
  if (prefs.shuffle) { isShuffle = true; shuffleBtn.classList.add('active'); }
  if (prefs.repeat) { isRepeat = true; repeatBtn.classList.add('active'); }
  audio.loop = isRepeat;

  function savePrefs() {
    localStorage.setItem('jdh_audioPrefs', JSON.stringify({
      minimized: player.classList.contains('collapsed'),
      shuffle: isShuffle, repeat: isRepeat
    }));
  }

  function fmt(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2,'0')}`;
  }

  function setPlaying(playing) {
    isPlaying = playing;
    playIcon.style.display = playing ? 'none' : '';
    pauseIcon.style.display = playing ? '' : 'none';
  }

  playBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(err => console.warn('[audio] play blocked:', err.name));
    }
  });
  audio.addEventListener('play', () => setPlaying(true));
  audio.addEventListener('pause', () => setPlaying(false));
  audio.addEventListener('ended', () => { if (!isRepeat) setPlaying(false); });

  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    progress.style.width = pct + '%';
    currentEl.textContent = fmt(audio.currentTime);
  });
  audio.addEventListener('loadedmetadata', () => {
    durationEl.textContent = fmt(audio.duration);
  });

  slider.addEventListener('click', e => {
    const rect = slider.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    if (audio.duration && isFinite(audio.duration)) {
      audio.currentTime = pct * audio.duration;
      progress.style.width = (pct * 100) + '%';
    }
  });

  shuffleBtn.addEventListener('click', e => {
    e.stopPropagation();
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
    savePrefs();
  });
  repeatBtn.addEventListener('click', e => {
    e.stopPropagation();
    isRepeat = !isRepeat;
    repeatBtn.classList.toggle('active', isRepeat);
    audio.loop = isRepeat;
    savePrefs();
  });

  minimizeBtn.addEventListener('click', e => {
    e.stopPropagation();
    player.classList.add('collapsed');
    expandBtn.classList.add('visible');
    savePrefs();
  });
  expandBtn.addEventListener('click', e => {
    e.stopPropagation();
    player.classList.remove('collapsed');
    expandBtn.classList.remove('visible');
    savePrefs();
  });
})();

/* ============ FLOW FIELD BACKGROUND ANIMATION ============ */
(function() {
  const canvas = document.getElementById('flow-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let particles = [], width = 0, height = 0, dpr = 1;
  let mouseX = -1000, mouseY = -1000;
  let isDark = document.documentElement.classList.contains('dark');

  function colors() {
    return isDark
      ? { dot: 'rgba(120, 165, 255, 0.75)', trail: 'rgba(0,0,0,0.07)' }
      : { dot: 'rgba(38, 103, 255, 0.55)', trail: 'rgba(255,255,255,0.10)' };
  }

  function init() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset before scaling
    ctx.scale(dpr, dpr);

    particles = [];
    const count = window.innerWidth < 768 ? 220 : 520;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: 0, vy: 0,
        age: 0,
        life: Math.random() * 200 + 100,
      });
    }
  }

  function step() {
    const c = colors();
    ctx.fillStyle = c.trail;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = c.dot;
    particles.forEach(p => {
      const angle = (Math.cos(p.x * 0.005) + Math.sin(p.y * 0.005)) * Math.PI;
      p.vx += Math.cos(angle) * 0.16;
      p.vy += Math.sin(angle) * 0.16;

      const dx = mouseX - p.x;
      const dy = mouseY - p.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < 150) {
        const f = (150 - dist) / 150;
        p.vx -= dx * f * 0.04;
        p.vy -= dy * f * 0.04;
      }

      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.95; p.vy *= 0.95;
      p.age++;

      if (p.age > p.life) {
        p.x = Math.random() * width;
        p.y = Math.random() * height;
        p.vx = 0; p.vy = 0;
        p.age = 0;
        p.life = Math.random() * 200 + 100;
      }
      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      const alpha = 1 - Math.abs((p.age / p.life) - 0.5) * 2;
      ctx.globalAlpha = alpha;
      ctx.fillRect(p.x, p.y, 1.5, 1.5);
    });
    ctx.globalAlpha = 1;
    requestAnimationFrame(step);
  }

  window.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
  window.addEventListener('mouseleave', () => { mouseX = -1000; mouseY = -1000; });
  window.addEventListener('resize', init);

  // Detect theme changes
  new MutationObserver(() => {
    isDark = document.documentElement.classList.contains('dark');
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  init();
  step();
})();
