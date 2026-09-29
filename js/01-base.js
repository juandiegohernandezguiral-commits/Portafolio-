/* 01-base.js - configuracion, tema, loader y registro del service worker.
   Primer script en cargar: todo lo demas asume que el tema ya se aplico. */

const ACCESS_PIN = '1021';

/* ============ THEME TOGGLE ============ */
const themeToggle = document.getElementById('theme-toggle');
const themeIconSun = document.getElementById('theme-icon-sun');
const themeIconMoon = document.getElementById('theme-icon-moon');

function applyTheme(isDark) {
  document.documentElement.classList.toggle('dark', isDark);
  themeIconSun.style.display = isDark ? 'none' : 'block';
  themeIconMoon.style.display = isDark ? 'block' : 'none';
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}
themeToggle.addEventListener('click', () => {
  applyTheme(!document.documentElement.classList.contains('dark'));
});
themeToggle.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); themeToggle.click(); }
});
// Set initial icon state based on current theme
applyTheme(document.documentElement.classList.contains('dark'));

/* ============ LOADER ============ */
const loadNum = document.getElementById('load-num');
const loadStart = performance.now();
function loadTick() {
  const p = Math.min(1, (performance.now() - loadStart) / 1400);
  loadNum.textContent = String(Math.round(p * 100)).padStart(2, '0');
  if (p < 1) requestAnimationFrame(loadTick);
}
loadTick();
window.addEventListener('load', () => {
  setTimeout(() => {
    document.getElementById('loader').classList.add('done');
    initAnimations();
  }, 1500);
});

/* ============ PWA: SERVICE WORKER ============
   Registro básico — sw.js trae los listeners de 'push' y 'notificationclick' que renderizan
   las notificaciones reales enviadas por el backend serverless (ver /netlify/functions). El
   registro de la suscripción (VAPID) ocurre al pulsar "Activar notificaciones" en el panel
   privado (sección Agenda → Centro de tareas) — ver el handler de #enable-notifications-btn. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('[sw] registration failed:', err));
  });
}
