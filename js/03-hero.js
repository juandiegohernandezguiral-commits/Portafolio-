/* 03-hero.js - hero de expansion por scroll, guardas del video de intro,
   smooth scroll (Lenis) y animaciones GSAP/ScrollTrigger de las secciones. */

/* ============ SCROLL-EXPANSION HERO ============ */
const introSection = document.getElementById('intro-section');
const introBg = document.getElementById('intro-bg');
const introMedia = document.getElementById('intro-media');
const titleLeft = document.getElementById('title-left');
const titleRight = document.getElementById('title-right');
const introHintText = document.getElementById('intro-hint-text');
const contentSpacer = document.getElementById('intro-content-spacer');

/* ============ VIDEO LOAD + AUTOPLAY GUARD ============ */
(function() {
  const video = document.getElementById('intro-video');
  const fallback = document.getElementById('video-fallback');
  if (!video) return;

  video.muted = true;
  video.playsInline = true;
  video.removeAttribute('disablepictureinpicture');

  function tryPlay() {
    const p = video.play();
    if (p !== undefined) {
      p.catch(err => {
        console.warn('[intro-video] autoplay blocked:', err.name, '— click anywhere to play');
      });
    }
  }

  function showFallback(reason) {
    console.error('[intro-video] FAILED:', reason);
    if (fallback) fallback.classList.add('visible');
  }

  // Detailed diagnostics
  video.addEventListener('loadedmetadata', () => {
    console.log('[intro-video] METADATA:', {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      duration: video.duration + 's',
      readyState: video.readyState
    });
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      console.error('[intro-video] ⚠ VIDEO HAS ZERO DIMENSIONS — codec is probably unsupported (likely HEVC/H.265). Re-encode the file as H.264 MP4.');
      showFallback('codec unsupported (videoWidth=0)');
    }
  });

  video.addEventListener('loadeddata', () => {
    console.log('[intro-video] loaded ok, attempting play');
    tryPlay();
  });

  video.addEventListener('playing', () => {
    console.log('[intro-video] ▶ PLAYING NOW. currentTime:', video.currentTime);
  });

  video.addEventListener('error', () => {
    const err = video.error;
    showFallback('error code=' + (err ? err.code : '?') + ' message=' + (err ? err.message : '?'));
  });
  video.querySelector('source').addEventListener('error', () => showFallback('source 404 / unsupported'));

  // Retry play on user interaction (autoplay policy fallback)
  const retry = () => tryPlay();
  document.addEventListener('click', retry);
  document.addEventListener('wheel', retry, { passive: true });
  document.addEventListener('touchstart', retry, { passive: true });

  video.load();
  tryPlay();

  /* Red de seguridad.
     Antes esto corría a los 5 s y, si todavía no había metadatos, daba el vídeo
     por ausente. Era un error de diagnóstico: "aún no han llegado los metadatos"
     y "el archivo no existe" no son lo mismo. Con intro.mp4 pesando 12 MB, una
     conexión lenta tarda bastante más de 5 s, y el visitante acababa viendo un
     mensaje de depuración en la portada aunque todo estuviera bien.

     Un archivo que falta o que no se puede decodificar YA lo detectan los
     eventos 'error' del <video> y del <source>, que son la señal fiable. Aquí
     sólo queda el caso que esos eventos no cubren: el vídeo carga, declara
     metadatos, pero sus dimensiones son cero — síntoma de un códec que el
     navegador no sabe pintar (típicamente HEVC/H.265). Si ni siquiera han
     llegado los metadatos, no se concluye nada: se deja seguir cargando. */
  setTimeout(() => {
    // readyState >= 1 (HAVE_METADATA): ya sabemos de verdad cómo es el vídeo.
    if (video.readyState >= 1 && video.videoWidth === 0) {
      showFallback('codec no soportado (videoWidth=0) — reencodea el archivo como H.264');
    } else if (video.readyState === 0) {
      console.warn('[intro-video] sin metadatos todavía; probablemente sigue descargando. No se muestra fallback.');
    } else if (video.paused) {
      console.warn('[intro-video] en pausa — autoplay bloqueado. Un clic en cualquier parte lo arranca.');
    }
  }, 15000);
})();

let scrollProgress = 0;
let mediaFullyExpanded = false;
let isMobile = window.innerWidth < 768;
window.addEventListener('resize', () => { isMobile = window.innerWidth < 768; });

function updateIntroVisuals() {
  const baseW = 320;
  const baseH = 400;
  const addW = isMobile ? 700 : 1300;
  const addH = isMobile ? 200 : 400;
  const w = baseW + scrollProgress * addW;
  const h = baseH + scrollProgress * addH;
  introMedia.style.width = w + 'px';
  introMedia.style.height = h + 'px';
  introMedia.style.maxWidth = '95vw';
  introMedia.style.maxHeight = '85vh';

  const tx = scrollProgress * (isMobile ? 35 : 30);
  if (titleLeft) titleLeft.style.transform = `translateX(-${tx}vw)`;
  if (titleRight) titleRight.style.transform = `translateX(${tx}vw)`;

  if (introBg) introBg.style.opacity = String(1 - scrollProgress * 0.6);

  if (introHintText) {
    introHintText.textContent = scrollProgress >= 1 ? 'Continúa explorando ↓' : 'Scroll para expandir';
  }
}
updateIntroVisuals();

function onWheel(e) {
  if (mediaFullyExpanded) {
    if (e.deltaY < 0 && window.scrollY <= 5) {
      mediaFullyExpanded = false;
      contentSpacer.style.height = '0';
      contentSpacer.style.opacity = '0';
      e.preventDefault();
    }
    return;
  }
  e.preventDefault();
  const delta = e.deltaY * 0.0012;
  scrollProgress = Math.min(Math.max(scrollProgress + delta, 0), 1);
  updateIntroVisuals();
  if (scrollProgress >= 1 && !mediaFullyExpanded) {
    mediaFullyExpanded = true;
    contentSpacer.style.height = 'auto';
    contentSpacer.style.opacity = '1';
  }
}

let touchY = 0;
function onTouchStart(e) { touchY = e.touches[0].clientY; }
function onTouchMove(e) {
  if (!touchY) return;
  const cy = e.touches[0].clientY;
  const dy = touchY - cy;
  if (mediaFullyExpanded) {
    if (dy < -20 && window.scrollY <= 5) {
      mediaFullyExpanded = false;
      contentSpacer.style.height = '0';
      contentSpacer.style.opacity = '0';
      e.preventDefault();
    }
    return;
  }
  e.preventDefault();
  scrollProgress = Math.min(Math.max(scrollProgress + dy * 0.005, 0), 1);
  updateIntroVisuals();
  if (scrollProgress >= 1) {
    mediaFullyExpanded = true;
    contentSpacer.style.height = 'auto';
    contentSpacer.style.opacity = '1';
  }
  touchY = cy;
}
function onTouchEnd() { touchY = 0; }
function lockScroll() {
  if (!mediaFullyExpanded) window.scrollTo(0, 0);
}

window.addEventListener('wheel', onWheel, { passive: false });
window.addEventListener('touchstart', onTouchStart, { passive: false });
window.addEventListener('touchmove', onTouchMove, { passive: false });
window.addEventListener('touchend', onTouchEnd);
window.addEventListener('scroll', lockScroll);

/* ============ LENIS smooth scroll (only when expanded) ============ */
let lenis = null;
function startLenis() {
  if (lenis) return;
  lenis = new Lenis({
    duration: 1.2,
    easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
  });
  function raf(t) { lenis && lenis.raf(t); requestAnimationFrame(raf); }
  requestAnimationFrame(raf);
  gsap.registerPlugin(ScrollTrigger);
  lenis.on('scroll', ScrollTrigger.update);
}

/* Wait until media expands to start GSAP/Lenis */
const expandWatcher = setInterval(() => {
  if (mediaFullyExpanded) {
    clearInterval(expandWatcher);
    startLenis();
    setTimeout(() => ScrollTrigger.refresh(), 200);
  }
}, 200);

/* ============ ANIMATIONS ============ */
function initAnimations() {
  gsap.registerPlugin(ScrollTrigger);
  gsap.utils.toArray('[data-anim]').forEach(el => {
    const type = el.dataset.anim;
    const delay = parseFloat(el.dataset.delay || 0);
    let from = {};
    if (type === 'rise') from = { y: 80, opacity: 0 };
    else if (type === 'fade-up') from = { y: 30, opacity: 0 };
    else from = { opacity: 0 };
    gsap.from(el, {
      ...from, duration: 1.1, delay, ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 88%', toggleActions: 'play none none none' }
    });
  });

  setupStackReveal();
  setupHorizontalScroll();
  setupCounters();
}

function setupCounters() {
  document.querySelectorAll('[data-counter]').forEach(el => {
    const target = parseInt(el.dataset.counter);
    const suffix = el.dataset.suffix || '';
    el.textContent = '0';
    ScrollTrigger.create({
      trigger: el, start: 'top 90%', once: true,
      onEnter: () => {
        const obj = { v: 0 };
        gsap.to(obj, { v: target, duration: 1.8, ease: 'power3.out', onUpdate: () => {
          el.innerHTML = Math.round(obj.v) + (suffix ? `<span class="text-2xl">${suffix}</span>` : '');
        }});
      }
    });
  });
}

function setupStackReveal() {
  const items = document.querySelectorAll('.stack-it');
  const progress = document.getElementById('stack-progress');
  if (!items.length) return;
  gsap.set(items, { opacity: 0, y: 40 });
  ScrollTrigger.create({
    trigger: '#stack', start: 'top top', end: 'bottom bottom', scrub: 0.5,
    onUpdate: self => {
      const visible = Math.ceil(self.progress * items.length);
      items.forEach((it, i) => gsap.to(it, { opacity: i < visible ? 1 : 0.15, y: i < visible ? 0 : 30, duration: 0.4 }));
      if (progress) progress.textContent = `${String(Math.min(visible, items.length)).padStart(2,'0')} / ${items.length}`;
    }
  });
}

function setupHorizontalScroll() {
  const hTrack = document.getElementById('h-scroll-track');
  const hSec = document.getElementById('h-scroll');
  if (!hTrack || !hSec || window.innerWidth <= 768) return;
  const totalWidth = () => hTrack.scrollWidth - window.innerWidth;
  gsap.to(hTrack, {
    x: () => -totalWidth(), ease: 'none',
    scrollTrigger: {
      trigger: hSec, start: 'top top', end: () => `+=${totalWidth()}`,
      pin: true, scrub: 0.5, invalidateOnRefresh: true
    }
  });
}
