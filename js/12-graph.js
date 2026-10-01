/* 12-graph.js — grafo de conocimiento: cada nota es un nodo, cada [[enlace]] una
   arista. Sirve para ver de un vistazo qué temas están realmente conectados y
   cuáles son notas huérfanas que nadie referencia.

   Disposición por simulación de fuerzas, escrita a mano sobre canvas:
     · repulsión entre todos los nodos (ley inversa del cuadrado, acotada)
     · atracción por muelle en cada arista
     · gravedad suave hacia el centro, para que no se escapen de la pantalla

   Sin d3 ni ninguna otra dependencia: son ~40 líneas de física y el proyecto no
   tiene build step. Con unos cientos de notas el bucle O(n²) de repulsión es
   irrelevante; si algún día llegan a miles, habría que pasar a un quadtree
   (Barnes-Hut) — anotado aquí para no tener que redescubrirlo. */

const graphState = {
  open: false,
  nodes: [],
  edges: [],
  raf: null,
  hover: null,
  drag: null,
  // Encuadre: se recalcula al abrir para que todo quepa.
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

function graphColors() {
  const dark = document.documentElement.classList.contains('dark');
  return {
    edge: dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.20)',
    orphanFill: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)',
    edgeActive: '#2667ff',
    node: dark ? '#1a1a1f' : '#ffffff',
    nodeBorder: dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.20)',
    accent: '#2667ff',
    text: dark ? 'rgba(255,255,255,0.80)' : 'rgba(0,0,0,0.75)',
    textMuted: dark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.40)',
    orphan: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)',
  };
}

function buildGraph() {
  const idx = notesIndex();
  const active = notes.filter(n => !n.archived);

  const nodes = active.map((n, i) => {
    // Posición inicial en espiral en vez de aleatoria: la simulación converge
    // más rápido y, sobre todo, el resultado es estable entre aperturas.
    const angle = i * 2.399;              // ángulo áureo, reparte bien
    const radius = 18 * Math.sqrt(i + 1);
    return {
      id: n.id,
      title: n.title || 'Sin título',
      daily: !!n.daily,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0, vy: 0,
      degree: 0,
    };
  });

  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges = [];
  const seen = new Set();

  active.forEach(n => {
    const source = byId.get(n.id);
    if (!source) return;
    (idx.outLinks.get(n.id) || new Set()).forEach(title => {
      const target = findNoteByTitle(title);
      if (!target || target.id === n.id) return;
      const t = byId.get(target.id);
      if (!t) return;
      // Dos notas que se enlazan mutuamente son una sola arista, no dos.
      const key = [n.id, target.id].sort().join('|');
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ source, target: t });
      source.degree++;
      t.degree++;
    });
  });

  graphState.nodes = nodes;
  graphState.edges = edges;
}

function stepGraphPhysics() {
  const { nodes, edges } = graphState;
  /* Estos cuatro números se ajustaron mirando el resultado, no en abstracto:
     con la repulsión más alta que tenían antes, media docena de notas quedaban
     desperdigadas por toda la pantalla y el grupo que de verdad importa (el
     conectado) se encogía hasta ser ilegible, porque el encuadre tiene que
     abarcar también a las huérfanas. Menos repulsión y más gravedad agrupan el
     conjunto, y las huérfanas se quedan cerca en vez de irse a las esquinas. */
  const REPULSION = 4200;
  const SPRING = 0.0016;
  const REST_LENGTH = 130;
  const GRAVITY = 0.010;
  const DAMPING = 0.86;

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = a.x - b.x, dy = a.y - b.y;
      let distSq = dx * dx + dy * dy;
      // Suelo en la distancia: sin él, dos nodos que coinciden generan una
      // fuerza infinita y la simulación explota.
      if (distSq < 1) { distSq = 1; dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); }
      const dist = Math.sqrt(distSq);
      const force = Math.min(REPULSION / distSq, 40);
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
  }

  edges.forEach(({ source, target }) => {
    const dx = target.x - source.x, dy = target.y - source.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (dist - REST_LENGTH) * SPRING * dist * 0.1;
    const fx = (dx / dist) * force, fy = (dy / dist) * force;
    source.vx += fx; source.vy += fy;
    target.vx -= fx; target.vy -= fy;
  });

  nodes.forEach(n => {
    n.vx -= n.x * GRAVITY;
    n.vy -= n.y * GRAVITY;
    if (graphState.drag === n) { n.vx = 0; n.vy = 0; return; }
    n.vx *= DAMPING; n.vy *= DAMPING;
    n.x += n.vx; n.y += n.vy;
  });
}

/* El radio comunica importancia: cuantas más notas se enlazan con una, más
   grande. Se acota en 8 para que un nodo central no se coma la pantalla. */
function nodeRadius(n) { return 9 + Math.min(n.degree, 8) * 2.6; }

function fitGraphToCanvas(canvas) {
  const { nodes } = graphState;
  if (!nodes.length) return;
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
  const padding = 120;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  graphState.scale = Math.min((cw - padding) / w, (ch - padding) / h, 2.2);
  graphState.offsetX = cw / 2 - ((minX + maxX) / 2) * graphState.scale;
  graphState.offsetY = ch / 2 + 20 - ((minY + maxY) / 2) * graphState.scale;
}

function toScreen(n) {
  return {
    x: n.x * graphState.scale + graphState.offsetX,
    y: n.y * graphState.scale + graphState.offsetY,
  };
}

function drawGraph() {
  const canvas = document.getElementById('graph-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
    canvas.width = cw * dpr; canvas.height = ch * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const c = graphColors();
  const hover = graphState.hover;
  const connected = new Set();
  if (hover) {
    graphState.edges.forEach(({ source, target }) => {
      if (source === hover) connected.add(target);
      if (target === hover) connected.add(source);
    });
  }

  // Aristas
  graphState.edges.forEach(({ source, target }) => {
    const a = toScreen(source), b = toScreen(target);
    const active = hover && (source === hover || target === hover);
    ctx.strokeStyle = active ? c.edgeActive : c.edge;
    ctx.lineWidth = active ? 1.6 : 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  // Nodos
  graphState.nodes.forEach(n => {
    const p = toScreen(n);
    const r = nodeRadius(n);
    const isHover = n === hover;
    const isNeighbour = connected.has(n);
    const dimmed = hover && !isHover && !isNeighbour;

    // Halo en el nodo señalado, para que salte a la vista cuál se está mirando.
    if (isHover) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(38,103,255,0.16)';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    if (n.degree === 0) {
      // Huérfana: visible pero apagada. Es información útil (nadie la enlaza),
      // no algo que haya que esconder.
      ctx.fillStyle = c.orphanFill;
    } else if (isHover || isNeighbour) {
      ctx.fillStyle = c.accent;
    } else {
      // Opacidad proporcional al grado: el mapa se lee de un vistazo.
      ctx.fillStyle = `rgba(38,103,255,${0.30 + Math.min(n.degree, 6) * 0.10})`;
    }
    ctx.fill();
    ctx.strokeStyle = isHover ? c.accent : (dimmed ? c.orphan : c.nodeBorder);
    ctx.lineWidth = isHover ? 2.5 : 1.2;
    ctx.stroke();

    // La etiqueta sólo cuando aporta: en los nodos importantes, los vecinos del
    // que se señala, o cuando el grafo es pequeño. Si no, es una maraña ilegible.
    const showLabel = isHover || isNeighbour || n.degree >= 3 || graphState.nodes.length <= 14;
    if (showLabel) {
      ctx.font = `${isHover ? '600 13px' : '400 11px'} Inter, system-ui, sans-serif`;
      ctx.fillStyle = dimmed ? c.textMuted : (isHover ? c.accent : c.text);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const label = n.title.length > 26 ? n.title.slice(0, 25) + '…' : n.title;
      ctx.fillText(label, p.x, p.y + r + 5);
    }
  });
}

function graphLoop() {
  if (!graphState.open) return;
  stepGraphPhysics();
  drawGraph();
  graphState.raf = requestAnimationFrame(graphLoop);
}

function openGraph() {
  commitNoteEdits();
  buildGraph();

  const overlay = document.getElementById('graph-overlay');
  const empty = document.getElementById('graph-empty');
  const stats = document.getElementById('graph-stats');
  if (!overlay) return;

  overlay.classList.remove('hidden');
  graphState.open = true;
  graphState.hover = null;

  const orphans = graphState.nodes.filter(n => n.degree === 0).length;
  if (stats) {
    stats.textContent = `${graphState.nodes.length} notas · ${graphState.edges.length} enlaces · ${orphans} sin conectar`;
  }
  if (empty) empty.classList.toggle('hidden', graphState.edges.length > 0);
  if (empty) empty.classList.toggle('flex', graphState.edges.length === 0);

  const canvas = document.getElementById('graph-canvas');
  // Unas cuantas iteraciones antes de dibujar, para que no se vea el estallido
  // inicial desde la espiral.
  for (let i = 0; i < 160; i++) stepGraphPhysics();
  fitGraphToCanvas(canvas);
  graphLoop();
}

function closeGraph() {
  graphState.open = false;
  if (graphState.raf) cancelAnimationFrame(graphState.raf);
  document.getElementById('graph-overlay')?.classList.add('hidden');
}

/* ---- Interacción ---- */

function graphNodeAt(clientX, clientY) {
  const canvas = document.getElementById('graph-canvas');
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  // De atrás hacia delante: coincide con el orden de pintado, así que gana el
  // nodo que se ve encima.
  for (let i = graphState.nodes.length - 1; i >= 0; i--) {
    const n = graphState.nodes[i];
    const p = toScreen(n);
    const r = nodeRadius(n) + 6;
    if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r * r) return n;
  }
  return null;
}

document.getElementById('open-graph-btn')?.addEventListener('click', openGraph);
document.getElementById('graph-close-btn')?.addEventListener('click', closeGraph);

const graphCanvas = document.getElementById('graph-canvas');

graphCanvas?.addEventListener('mousemove', e => {
  if (!graphState.open) return;
  if (graphState.drag) {
    const rect = graphCanvas.getBoundingClientRect();
    graphState.drag.x = (e.clientX - rect.left - graphState.offsetX) / graphState.scale;
    graphState.drag.y = (e.clientY - rect.top - graphState.offsetY) / graphState.scale;
    return;
  }
  const node = graphNodeAt(e.clientX, e.clientY);
  if (node !== graphState.hover) {
    graphState.hover = node;
    graphCanvas.style.cursor = node ? 'pointer' : 'default';
  }
});

graphCanvas?.addEventListener('mousedown', e => {
  const node = graphNodeAt(e.clientX, e.clientY);
  if (node) { graphState.drag = node; graphState.dragMoved = false; }
});

window.addEventListener('mouseup', () => { graphState.drag = null; });

graphCanvas?.addEventListener('click', e => {
  const node = graphNodeAt(e.clientX, e.clientY);
  if (!node) return;
  closeGraph();
  notesUi.selectedId = node.id;
  notesUi.showArchived = false;
  showView('notes');
});

graphCanvas?.addEventListener('mouseleave', () => { graphState.hover = null; });

window.addEventListener('resize', () => {
  if (graphState.open) fitGraphToCanvas(document.getElementById('graph-canvas'));
});

document.addEventListener('keydown', e => {
  if (graphState.open && e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeGraph();
  }
}, true);
