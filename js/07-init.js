/* 07-init.js - arranque del dashboard (semilla inicial) y resaltado del nav.
   Ultimo script: asume que todo lo anterior ya esta definido. */

function initDashboard() {
  if (!localStorage.getItem('jdh_seeded')) {
    tasks = [
      { id: uid(), title: 'Diseñar wireframes para cliente', desc: 'Reunión inicial completada', priority: 'high', status: 'todo' },
      { id: uid(), title: 'Subir portafolio a Hostinger', priority: 'high', status: 'doing' },
      { id: uid(), title: 'Estudiar para parcial de algoritmos', priority: 'med', status: 'todo' },
    ];
    projects = [{ id: uid(), name: 'Portafolio personal', client: '', desc: 'Sitio cinematográfico con dashboard privado.', deadline: '', stages: STAGES.map((s, i) => ({ name: s, done: i < 3 })) }];
    notes = [{ id: uid(), title: 'Ideas para próximos proyectos', content: '- App de gestión de tareas\n- Tienda online emprendimiento local\n- Sistema de turnos para barberías', createdAt: Date.now() }];
    saveAll();
    localStorage.setItem('jdh_seeded', '1');
  }
  showView('overview');
}

/* Nav highlight */
const navLinks = document.querySelectorAll('.nav-link');
window.addEventListener('scroll', () => {
  const sections = ['about','stack','work','services','contact'].map(id => document.getElementById(id)).filter(Boolean);
  const y = window.scrollY + 200; let current = 'about';
  sections.forEach(s => { if (s.offsetTop <= y) current = s.id; });
  navLinks.forEach(l => l.classList.toggle('text-accent', l.getAttribute('href') === '#' + current));
});
