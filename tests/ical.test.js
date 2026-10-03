/* Prueba el parseo de los calendarios de Moodle (netlify/functions/study-ical.js).

   Está aquí por la misma razón que la prueba de precios: un fallo no se ve. Si
   el plegado de líneas no se deshace, el título de una tarea llega cortado por
   la mitad; si una fecha se interpreta en la zona horaria equivocada, la entrega
   aparece el día de antes o el de después. Ninguna de las dos cosas lanza un
   error — simplemente te enteras tarde. */

const { _internals } = require('../netlify/functions/study-ical.js');
const { desplegar, fechaISO, clasificar, limpiarTitulo, parsearICal, urlValida } = _internals;

let pasadas = 0, falladas = 0;
function ok(nombre, cond, extra) {
  if (cond) { pasadas++; return; }
  falladas++;
  console.error('  ✗ ' + nombre + (extra ? '\n      ' + extra : ''));
}
function igual(nombre, a, b) { ok(nombre, a === b, `esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`); }
function grupo(n) { console.log('\n' + n); }

grupo('Plegado de líneas (RFC 5545)');
{
  // Moodle parte toda línea de más de 75 octetos y continúa con un espacio.
  const plegado = 'SUMMARY:Taller de derivadas y reglas de\n  la cadena, puntos 1 al 12';
  igual('une la continuación con espacio',
    desplegar(plegado), 'SUMMARY:Taller de derivadas y reglas de la cadena, puntos 1 al 12');

  igual('une también con tabulador',
    desplegar('A:uno\n\tdos'), 'A:unodos');

  igual('CRLF se normaliza', desplegar('A:x\r\nB:y'), 'A:x\nB:y');

  // Una línea nueva de verdad (sin espacio inicial) NO se une.
  igual('no une líneas independientes', desplegar('A:x\nB:y'), 'A:x\nB:y');
}

grupo('Fechas');
{
  igual('UTC con Z', fechaISO('20260315T140000Z', ''), '2026-03-15T14:00:00.000Z');

  // Sin Z Moodle la da en hora de Colombia (UTC-5): las 14:00 locales son las
  // 19:00 UTC. Si esto se tratara como UTC, la entrega saldría 5 horas antes.
  igual('sin Z se convierte desde Colombia', fechaISO('20260315T140000', ''), '2026-03-15T19:00:00.000Z');

  // Evento de día completo: se fija a mediodía y no a medianoche, porque a las
  // 00:00 una entrega "del 15" aparece vencida durante todo el día 15.
  igual('sólo fecha va a mediodía', fechaISO('20260315', ''), '2026-03-15T12:00:00.000Z');
  igual('VALUE=DATE también', fechaISO('20260315T000000', 'VALUE=DATE'), '2026-03-15T12:00:00.000Z');

  ok('basura devuelve null', fechaISO('no-es-fecha', '') === null);
  ok('vacío devuelve null', fechaISO('', '') === null);
}

grupo('Clasificación por el título');
{
  igual('parcial', clasificar('Parcial 1 de Cálculo'), 'parcial');
  igual('examen cuenta como parcial', clasificar('Examen final'), 'parcial');
  igual('quiz', clasificar('Quiz semana 4'), 'quiz');
  igual('cuestionario es quiz', clasificar('Cuestionario de repaso'), 'quiz');
  igual('proyecto', clasificar('Proyecto final de Programación'), 'proyecto');
  igual('exposición con tilde', clasificar('Exposición sobre APIs'), 'exposicion');
  igual('exposicion sin tilde', clasificar('Exposicion grupal'), 'exposicion');
  igual('taller es tarea', clasificar('Taller de arreglos'), 'tarea');
  igual('laboratorio es tarea', clasificar('Laboratorio 3'), 'tarea');
  // Lo que no encaja en nada cae en tarea, que es el caso más común.
  igual('desconocido cae en tarea', clasificar('Algo rarísimo'), 'tarea');

  // Casos de precedencia: el orden de las reglas es lo que los resuelve.
  igual('proyecto final NO es parcial', clasificar('Proyecto final de Programación'), 'proyecto');
  igual('entrega final es proyecto', clasificar('Entrega final del curso'), 'proyecto');
  igual('examen final sí es parcial', clasificar('Examen final'), 'parcial');
  igual('evaluación final es parcial', clasificar('Evaluación final de unidad'), 'parcial');
  igual('exposición final es exposición', clasificar('Exposición final grupal'), 'exposicion');
}

grupo('Limpieza de títulos');
{
  igual('quita el curso entre paréntesis',
    limpiarTitulo('Taller 1 (Cálculo Diferencial)'), 'Taller 1');
  igual('quita "debe entregarse"',
    limpiarTitulo('Taller 1 debe entregarse'), 'Taller 1');
  igual('quita el "is due" en inglés',
    limpiarTitulo('Assignment 1 is due'), 'Assignment 1');
  igual('deja en paz lo que ya está limpio',
    limpiarTitulo('Parcial 1'), 'Parcial 1');
}

grupo('Calendario completo de Moodle');
{
  // Reproduce la forma real: VCALENDAR, líneas plegadas, un evento con hora y
  // otro de día completo, y CATEGORIES con el nombre del curso.
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Moodle Pty Ltd//NONSGML Moodle Version 2023100900//EN',
    'BEGIN:VEVENT',
    'UID:1234@cvirtual.itm.edu.co',
    'SUMMARY:Taller de derivadas y reglas de',
    '  la cadena debe entregarse',
    'DTSTART:20260315T235900',
    'DESCRIPTION:Resolver los puntos 1 al 12\\nEntregar en PDF',
    'CATEGORIES:Cálculo Diferencial',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:5678@cvirtual.itm.edu.co',
    'SUMMARY:Parcial 1 (Programación I)',
    'DTSTART;VALUE=DATE:20260320',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:sin-fecha@itm',
    'SUMMARY:Evento sin fecha',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const items = parsearICal(ics);

  igual('descarta el evento sin fecha', items.length, 2);

  const a = items[0];
  igual('título desplegado y limpio', a.title, 'Taller de derivadas y reglas de la cadena');
  igual('curso desde CATEGORIES', a.course, 'Cálculo Diferencial');
  igual('uid como externalId', a.externalId, '1234@cvirtual.itm.edu.co');
  igual('fecha convertida desde Colombia', a.due, '2026-03-16T04:59:00.000Z');
  igual('clasificado como tarea', a.kind, 'tarea');
  ok('descripción con salto de línea desescapado', a.notes.includes('\nEntregar en PDF'), a.notes);

  const b = items[1];
  igual('curso desde el paréntesis', b.course, 'Programación I');
  igual('título sin el paréntesis', b.title, 'Parcial 1');
  igual('clasificado como parcial', b.kind, 'parcial');
  igual('día completo a mediodía', b.due, '2026-03-20T12:00:00.000Z');
}

grupo('Validación de la URL');
{
  const buena = 'https://cvirtual.itm.edu.co/calendar/export_execute.php?userid=9&authtoken=abc123&preset_what=all';
  ok('acepta una URL de Moodle bien formada', urlValida(buena) === null, String(urlValida(buena)));

  ok('rechaza http', /https/.test(urlValida(buena.replace('https:', 'http:')) || ''));
  ok('rechaza sin authtoken',
    /authtoken/i.test(urlValida('https://cvirtual.itm.edu.co/calendar/view.php') || ''));
  ok('rechaza una ruta que no es de calendario',
    /calendar/i.test(urlValida('https://cvirtual.itm.edu.co/login/index.php?authtoken=x') || ''));
  ok('rechaza basura', urlValida('no es una url') !== null);

  // El endpoint ya pide SYNC_TOKEN, pero aun asi no debe buscar cualquier cosa
  // que le manden: un error de tecleo no tiene por que acabar en una peticion a
  // un sitio ajeno.
  ok('rechaza un host arbitrario sin pinta de Moodle',
    urlValida('https://ejemplo.com/algo?authtoken=x') !== null);
}

console.log(`\n${pasadas} pasadas, ${falladas} falladas`);
process.exit(falladas ? 1 : 0);
