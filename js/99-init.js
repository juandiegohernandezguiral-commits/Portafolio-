/* 07-init.js - arranque del dashboard (semilla inicial) y resaltado del nav.
   Ultimo script: asume que todo lo anterior ya esta definido. */

function initDashboard() {
  if (!localStorage.getItem('jdh_seeded')) {
    tasks = [
      { id: uid(), title: 'Diseñar wireframes para cliente', desc: 'Reunión inicial completada', priority: 'high', status: 'todo' },
      { id: uid(), title: 'Publicar el portafolio', priority: 'high', status: 'doing' },
      { id: uid(), title: 'Estudiar para parcial de algoritmos', priority: 'med', status: 'todo' },
    ];
    projects = [{ id: uid(), name: 'Portafolio personal', client: '', desc: 'Sitio cinematográfico con dashboard privado.', deadline: '', stages: STAGES.map((s, i) => ({ name: s, done: i < 3 })) }];
    notes = [{ id: uid(), title: 'Ideas para próximos proyectos', content: '- App de gestión de tareas\n- Tienda online emprendimiento local\n- Sistema de turnos para barberías', createdAt: Date.now() }];
    saveAll();
    localStorage.setItem('jdh_seeded', '1');
  }

  // Sella los registros anteriores a que existiera `updatedAt` (ver js/05-dashboard.js).
  // Debe correr ANTES del primer sync: sin marca de tiempo, un merge no sabría
  // distinguir lo viejo de lo nuevo y podría descartar datos válidos.
  migrateTimestamps();
  // Las notas anteriores no tenían pinned/archived/daily (ver js/11-notes.js).
  migrateNotes();
  // Siembra las plantillas de serie una sola vez, para que la función sirva
  // desde el primer día en vez de pedir configurarla antes de poder probarla.
  if (typeof seedTemplatesOnce === 'function') seedTemplatesOnce();

  // Arranca en "Hoy" en vez de "Resumen": es la vista que responde a la pregunta
  // con la que uno abre el panel (¿qué tengo que hacer?), no a la de cuántas
  // cosas tengo guardadas.
  showView('today');

  if (typeof renderSyncStatus === 'function') renderSyncStatus();
  if (typeof renderNoticeBadge === 'function') renderNoticeBadge();
  // Las reglas se evalúan al abrir el panel: es el momento en que lo que
  // detecten todavía sirve de algo.
  if (typeof runRules === 'function') runRules();
  // Al abrir el panel se traen los cambios hechos en otros dispositivos.
  if (typeof isSyncConfigured === 'function' && isSyncConfigured()) syncNow();
}

/* Atajo de la PWA instalada: el manifest declara un shortcut a /index.html#hoy
   (mantener pulsado el icono en Android → "Hoy"). Abre directamente la pantalla
   del PIN en vez de dejar al usuario en la portada; el PIN sigue siendo
   obligatorio — el hash sólo ahorra un clic, no salta la verificación. */
if (window.location.hash === '#hoy') {
  window.addEventListener('load', () => {
    // Tras el loader (~1.5 s), para que no se abra sobre la animación de carga.
    setTimeout(() => {
      openDashboard();
      // Se limpia el hash para que recargar no vuelva a forzar la apertura.
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }, 1600);
  });
}

/* Nav highlight */
const navLinks = document.querySelectorAll('.nav-link');
window.addEventListener('scroll', () => {
  const sections = ['about','stack','work','services','contact'].map(id => document.getElementById(id)).filter(Boolean);
  const y = window.scrollY + 200; let current = 'about';
  sections.forEach(s => { if (s.offsetTop <= y) current = s.id; });
  navLinks.forEach(l => l.classList.toggle('text-accent', l.getAttribute('href') === '#' + current));
});
