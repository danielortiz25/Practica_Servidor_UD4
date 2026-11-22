import express from 'express';
import { fileURLToPath } from 'node:url';
import { pool } from './db.mjs';
import { crearRepositorioEquipos } from './equipos.repo.mjs';
import { crearServicioPrestamos } from './prestamos.service.mjs';

const app = express();
const equipos = crearRepositorioEquipos(pool);
const prestamos = crearServicioPrestamos(pool);

app.set('view engine', 'ejs');
app.set('views', fileURLToPath(new URL('../views/', import.meta.url)));
app.use(express.json({ limit: '10kb' }));

const TAMANO_PAGINA = 5;

// ---------- Validaciones ----------
// Id procedente de la URL (texto)
function leerId(texto) {
  const id = Number(texto);
  if (!/^[1-9]\d*$/.test(texto) || !Number.isSafeInteger(id) ||
      id > 2147483647) return null;
  return id;
}
// Id procedente del cuerpo JSON (número)
const idValido = x => Number.isInteger(x) && x > 0 && x <= 2147483647;

function datosEquipoValidos(b) {
  return b && typeof b === 'object' && !Array.isArray(b) &&
    typeof b.codigo === 'string' &&
    typeof b.nombre === 'string' &&
    typeof b.categoria === 'string' &&
    /^[A-Z0-9-]{1,20}$/.test(b.codigo) &&
    b.nombre.trim().length >= 1 && b.nombre.trim().length <= 80 &&
    b.categoria.trim().length >= 1 && b.categoria.trim().length <= 40;
}
const limpiarEquipo = b => ({
  codigo: b.codigo, nombre: b.nombre.trim(), categoria: b.categoria.trim()
});

// ---------- Modelos de vista ----------
const formatoFecha = f => f
  ? f.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })
  : null;
const aVistaEquipo = fila => ({
  id: fila.id, codigo: fila.codigo, nombre: fila.nombre,
  categoria: fila.categoria,
  estado: fila.disponible ? 'disponible' : 'prestado'
});

// ---------- Vistas HTML ----------
app.get('/', (req, res) => res.redirect('/equipos'));

app.get('/equipos', async (req, res) => {
  const q = req.query.q ?? '';
  const categoria = req.query.categoria ?? '';
  const disponible = req.query.disponible ?? '';
  const orden = req.query.orden ?? 'codigo';
  const textoPagina = req.query.pagina ?? '1';
  if (typeof q !== 'string' || q.length > 80 ||
      typeof categoria !== 'string' || categoria.length > 40 ||
      !['', 'si', 'no'].includes(disponible) ||
      !['codigo', 'nombre'].includes(orden) ||
      typeof textoPagina !== 'string' ||
      !/^[1-9]\d{0,3}$/.test(textoPagina)) {
    return res.status(400).send('Filtros no válidos');
  }
  const pagina = Number(textoPagina);
  const filas = await equipos.listar({
    q, categoria,
    disponible: disponible === '' ? null : disponible === 'si',
    orden,
    limite: TAMANO_PAGINA + 1,              // una fila más para saber si hay siguiente
    desplazamiento: (pagina - 1) * TAMANO_PAGINA
  });
  const categorias = await equipos.categorias();
  const enlace = n => '/equipos?' + new URLSearchParams({
    q, categoria, disponible, orden, pagina: String(n)
  });
  res.render('equipos', {
    equipos: filas.slice(0, TAMANO_PAGINA).map(aVistaEquipo),
    categorias, q, categoria, disponible, orden, pagina,
    anterior: pagina > 1 ? enlace(pagina - 1) : null,
    siguiente: filas.length > TAMANO_PAGINA ? enlace(pagina + 1) : null
  });
});

app.get('/equipos/:id', async (req, res) => {
  const id = leerId(req.params.id);
  if (id === null) return res.status(400).send('Id no válido');
  const fila = await equipos.buscarDetalle(id);
  if (!fila) return res.status(404).send('Equipo inexistente');
  const historial = await equipos.historial(id);
  res.render('equipo', {
    equipo: {
      ...aVistaEquipo(fila),
      usuarioActual: fila.usuario_actual,
      prestadoDesde: formatoFecha(fila.prestado_desde)
    },
    prestamos: historial.map(p => ({
      id: p.id, usuario: p.usuario,
      fechaPrestamo: formatoFecha(p.fecha_prestamo),
      fechaDevolucion: formatoFecha(p.fecha_devolucion) ?? 'Pendiente'
    }))
  });
});

// ---------- API JSON: inventario ----------
app.post('/api/equipos', async (req, res) => {
  if (!datosEquipoValidos(req.body))
    return res.status(400).json({ error: 'DATOS_INVALIDOS' });
  const equipo = await equipos.crear(limpiarEquipo(req.body));
  res.status(201).location(`/api/equipos/${equipo.id}`).json(equipo);
});

app.put('/api/equipos/:id', async (req, res) => {
  const id = leerId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID_INVALIDO' });
  if (!datosEquipoValidos(req.body))
    return res.status(400).json({ error: 'DATOS_INVALIDOS' });
  const equipo = await equipos.actualizar(id, limpiarEquipo(req.body));
  if (!equipo) return res.status(404).json({ error: 'NO_EXISTE' });
  res.json(equipo);
});

app.delete('/api/equipos/:id', async (req, res) => {
  const id = leerId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID_INVALIDO' });
  const borrado = await equipos.eliminar(id);
  if (!borrado) return res.status(404).json({ error: 'NO_EXISTE' });
  res.status(204).end();
});

// ---------- API JSON: préstamos ----------
app.post('/api/prestamos', async (req, res) => {
  const { equipoId, usuarioId } = req.body ?? {};
  if (!idValido(equipoId) || !idValido(usuarioId))
    return res.status(400).json({ error: 'DATOS_INVALIDOS' });
  const prestamo = await prestamos.prestar(equipoId, usuarioId);
  res.status(201).json(prestamo);
});

app.post('/api/prestamos/:id/devolucion', async (req, res) => {
  const id = leerId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID_INVALIDO' });
  res.json(await prestamos.devolver(id));
});

// ---------- Errores ----------
app.use((req, res) => res.status(404).json({ error: 'RUTA_INEXISTENTE' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed')
    return res.status(400).json({ error: 'JSON_INVALIDO' });
  if (err.type === 'entity.too.large')
    return res.status(413).json({ error: 'CUERPO_EXCESIVO' });
  // Errores de dominio del servicio
  if (['NO_DISPONIBLE', 'NO_ACTIVO'].includes(err.codigo))
    return res.status(409).json({ error: err.codigo });
  // Errores de PostgreSQL por SQLSTATE (nunca se envía el mensaje técnico)
  if (err.code === '23505') {
    const error = err.constraint === 'equipos_codigo_unico'
      ? 'CODIGO_DUPLICADO' : 'CONFLICTO';
    return res.status(409).json({ error });
  }
  if (err.code === '23503') {
    if (err.constraint === 'prestamos_usuario_fk')
      return res.status(400).json({ error: 'USUARIO_INEXISTENTE' });
    if (err.constraint === 'prestamos_equipo_fk')
      return res.status(409).json({ error: 'TIENE_PRESTAMOS' });
    return res.status(409).json({ error: 'DATOS_RELACIONADOS' });
  }
  if (['23502', '23514'].includes(err.code))
    return res.status(400).json({ error: 'DATOS_NO_ADMITIDOS' });
  console.error('Error en la aplicación de préstamos');
  res.status(500).json({ error: 'ERROR_INTERNO' });
});

// ---------- Arranque y cierre ----------
try {
  const r = await pool.query('SELECT 1 AS comprobacion');
  console.log('Conexión comprobada:', r.rows[0].comprobacion);
  const servidor = app.listen(Number(process.env.PORT ?? 3000),
    '127.0.0.1', () => console.log('HTTP preparado'));
  const cerrar = () => servidor.close(async () => { await pool.end(); });
  process.once('SIGINT', cerrar);
  process.once('SIGTERM', cerrar);
} catch {
  console.error('No se pudo conectar con PostgreSQL');
  await pool.end();
  process.exitCode = 1;
}
