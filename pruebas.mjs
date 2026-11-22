// Comprobaciones manuales con fetch. Requisitos:
//   1. Ejecutar antes init.sql (datos iniciales conocidos).
//   2. Tener el servidor arrancado: npm start
// Uso: node --env-file=.env pruebas.mjs
import { pool } from './src/db.mjs';

const base = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
const resultados = [];

function comprobar(caso, peticion, esperado, obtenido) {
  const ok = String(esperado) === String(obtenido);
  resultados.push({ caso, peticion, esperado, obtenido, ok: ok ? 'OK' : 'FALLO' });
}
const json = (method, datos) => ({
  method, headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(datos)
});
async function fila(sql, valores = []) {
  return (await pool.query(sql, valores)).rows[0];
}
const idDe = async codigo => (await fila(
  'SELECT id FROM practica_prestamos.equipos WHERE codigo=$1', [codigo])).id;

try {
  // ---------- Alta y modificación ----------
  let r = await fetch(`${base}/api/equipos`, json('POST',
    { codigo: 'TEST-01', nombre: 'Portátil de pruebas', categoria: 'portatil' }));
  const creado = await r.json();
  comprobar('Alta', 'POST /api/equipos', 201, r.status);
  comprobar('Alta', 'Cabecera Location', `/api/equipos/${creado.id}`,
    r.headers.get('location'));

  r = await fetch(`${base}/api/equipos/${creado.id}`, json('PUT',
    { codigo: 'TEST-01', nombre: 'Portátil de pruebas (mod)', categoria: 'portatil' }));
  comprobar('Modificación', `PUT /api/equipos/${creado.id}`, 200, r.status);

  r = await fetch(`${base}/api/equipos`, json('POST',
    { codigo: 'TEST-01', nombre: 'Otro', categoria: 'portatil' }));
  comprobar('Código repetido', 'POST /api/equipos (TEST-01 otra vez)', 409, r.status);

  r = await fetch(`${base}/api/equipos/999999`, json('PUT',
    { codigo: 'X-1', nombre: 'No existe', categoria: 'otro' }));
  comprobar('Modificación', 'PUT /api/equipos/999999', 404, r.status);

  r = await fetch(`${base}/api/equipos`, json('POST',
    { codigo: '', nombre: '   ', categoria: 'portatil' }));
  comprobar('Validación', 'POST con codigo y nombre vacíos', 400, r.status);

  r = await fetch(`${base}/api/equipos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: '{"codigo": "MAL'
  });
  comprobar('Validación', 'POST con JSON mal formado', 400, r.status);

  // ---------- Consulta y filtros ----------
  r = await fetch(`${base}/equipos?q=PORT`);
  comprobar('Filtros', 'GET /equipos?q=PORT (ILIKE)', 200, r.status);
  r = await fetch(`${base}/equipos?categoria=tableta&disponible=si&orden=nombre`);
  comprobar('Filtros', 'GET /equipos?categoria=tableta&disponible=si&orden=nombre', 200, r.status);
  r = await fetch(`${base}/equipos?pagina=2`);
  comprobar('Filtros', 'GET /equipos?pagina=2', 200, r.status);
  r = await fetch(`${base}/equipos?pagina=0`);
  comprobar('Filtros', 'GET /equipos?pagina=0', 400, r.status);
  r = await fetch(`${base}/equipos?orden=id;DROP`);
  comprobar('Filtros', 'GET /equipos?orden no permitido', 400, r.status);
  r = await fetch(`${base}/equipos/abc`);
  comprobar('Detalle', 'GET /equipos/abc', 400, r.status);
  r = await fetch(`${base}/equipos/999999`);
  comprobar('Detalle', 'GET /equipos/999999', 404, r.status);

  // ---------- Borrado ----------
  r = await fetch(`${base}/api/equipos/${creado.id}`, { method: 'DELETE' });
  comprobar('Borrado', `DELETE /api/equipos/${creado.id} (sin historial)`, 204, r.status);
  r = await fetch(`${base}/api/equipos/999999`, { method: 'DELETE' });
  comprobar('Borrado', 'DELETE /api/equipos/999999', 404, r.status);
  const por002 = await idDe('POR-002');
  r = await fetch(`${base}/api/equipos/${por002}`, { method: 'DELETE' });
  comprobar('Borrado', `DELETE /api/equipos/${por002} (POR-002, con historial)`, 409, r.status);

  // ---------- Préstamo correcto ----------
  const por001 = await idDe('POR-001');
  r = await fetch(`${base}/api/prestamos`, json('POST', { equipoId: por001, usuarioId: 1 }));
  const prestamo = await r.json();
  comprobar('Préstamo correcto', 'POST /api/prestamos (POR-001, usuario 1)', 201, r.status);
  let estado = await fila(
    `SELECT e.disponible,
       (SELECT count(*) FROM practica_prestamos.prestamos
        WHERE equipo_id=e.id AND fecha_devolucion IS NULL)::int AS activos
     FROM practica_prestamos.equipos e WHERE e.id=$1`, [por001]);
  comprobar('Préstamo correcto', 'BD: disponible / préstamos activos',
    'false/1', `${estado.disponible}/${estado.activos}`);

  // ---------- Préstamo duplicado ----------
  r = await fetch(`${base}/api/prestamos`, json('POST', { equipoId: por001, usuarioId: 2 }));
  comprobar('Préstamo duplicado', 'POST /api/prestamos (POR-001 otra vez)', 409, r.status);
  estado = await fila(
    `SELECT count(*)::int AS total FROM practica_prestamos.prestamos
     WHERE equipo_id=$1`, [por001]);
  comprobar('Préstamo duplicado', 'BD: filas de préstamo de POR-001', 1, estado.total);

  // ---------- Rollback ----------
  const por003 = await idDe('POR-003');
  r = await fetch(`${base}/api/prestamos`, json('POST', { equipoId: por003, usuarioId: 999 }));
  comprobar('Rollback', 'POST /api/prestamos (POR-003, usuario 999)', 400, r.status);
  estado = await fila(
    `SELECT e.disponible,
       (SELECT count(*) FROM practica_prestamos.prestamos WHERE equipo_id=e.id)::int AS total
     FROM practica_prestamos.equipos e WHERE e.id=$1`, [por003]);
  comprobar('Rollback', 'BD: disponible / préstamos de POR-003',
    'true/0', `${estado.disponible}/${estado.total}`);

  // ---------- Devolución ----------
  r = await fetch(`${base}/api/prestamos/${prestamo.id}/devolucion`, { method: 'POST' });
  comprobar('Devolución', `POST /api/prestamos/${prestamo.id}/devolucion`, 200, r.status);
  const tras1 = await fila(
    `SELECT p.fecha_devolucion, e.disponible
     FROM practica_prestamos.prestamos p
     JOIN practica_prestamos.equipos e ON e.id = p.equipo_id
     WHERE p.id=$1`, [prestamo.id]);
  comprobar('Devolución', 'BD: fecha_devolucion registrada / disponible',
    'true/true', `${tras1.fecha_devolucion !== null}/${tras1.disponible}`);

  r = await fetch(`${base}/api/prestamos/${prestamo.id}/devolucion`, { method: 'POST' });
  comprobar('Devolución', 'Segunda devolución del mismo préstamo', 409, r.status);
  const tras2 = await fila(
    'SELECT fecha_devolucion FROM practica_prestamos.prestamos WHERE id=$1',
    [prestamo.id]);
  comprobar('Devolución', 'BD: fecha_devolucion sin cambios', 'true',
    String(tras1.fecha_devolucion.getTime() === tras2.fecha_devolucion.getTime()));

  r = await fetch(`${base}/api/prestamos/999999/devolucion`, { method: 'POST' });
  comprobar('Devolución', 'Devolución de préstamo inexistente', 409, r.status);

  // ---------- Simultaneidad ----------
  const por004 = await idDe('POR-004');
  const respuestas = await Promise.all([
    fetch(`${base}/api/prestamos`, json('POST', { equipoId: por004, usuarioId: 1 })),
    fetch(`${base}/api/prestamos`, json('POST', { equipoId: por004, usuarioId: 2 }))
  ]);
  const codigos = respuestas.map(x => x.status).sort();
  comprobar('Simultaneidad', 'Dos POST /api/prestamos a la vez (POR-004)',
    '201,409', codigos.join(','));
  estado = await fila(
    `SELECT count(*)::int AS activos FROM practica_prestamos.prestamos
     WHERE equipo_id=$1 AND fecha_devolucion IS NULL`, [por004]);
  comprobar('Simultaneidad', 'BD: préstamos activos de POR-004', 1, estado.activos);

  console.table(resultados);
  const fallos = resultados.filter(x => x.ok !== 'OK').length;
  console.log(fallos ? `${fallos} comprobaciones fallidas` : 'Todas las comprobaciones OK');
} finally {
  await pool.end();
}
