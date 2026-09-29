/* 04-ui.js - interacciones del sitio publico: botones magneticos y el
   formulario de contacto. */

/* ============ MAGNETIC BUTTONS ============ */
document.querySelectorAll('.magnet').forEach(b => {
  b.addEventListener('mousemove', e => {
    const r = b.getBoundingClientRect();
    b.style.transform = `translate(${(e.clientX - r.left - r.width/2) * 0.2}px, ${(e.clientY - r.top - r.height/2) * 0.2}px)`;
  });
  b.addEventListener('mouseleave', () => b.style.transform = '');
});

/* ============ CONTACT FORM ============ */
document.getElementById('contact-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const msg = document.getElementById('form-msg');
  msg.classList.remove('hidden');
  msg.className = 'mono text-xs text-center text-accent';
  msg.textContent = '// mensaje enviado · respondo en menos de 24h ✓';
  e.target.reset();
  setTimeout(() => msg.classList.add('hidden'), 5000);
});
