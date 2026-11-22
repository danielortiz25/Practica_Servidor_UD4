// Repositorio de equipos: solo SQL y resultados, sin Express.
const ORDENES = {
  codigo: 'codigo, id',
  nombre: 'nombre, id'
};

export function crearRepositorioEquipos(pool) {
  return {
    // filtros = { q, categoria, disponible: true|false|null, orden, limite, desplazamiento }
    async listar(filtros) {
      const condiciones = [];
      const valores = [];
      if (filtros.q) {
        valores.push(`%${filtros.q}%`);
        condiciones.push(`nombre ILIKE $${valores.length}`);
      }
      if (filtros.categoria) {
        valores.push(filtros.categoria);
        condiciones.push(`categoria = $${valores.length}`);
      }
      if (filtros.disponible !== null) {
        valores.push(filtros.disponible);
        condiciones.push(`disponible = $${valores.length}`);
      }
      const where = condiciones.length
        ? 'WHERE ' + condiciones.join(' AND ')
        : '';
      // Solo se usan fragmentos fijos escritos aquí; nunca el texto recibido.
      const ordenSQL = ORDENES[filtros.orden] ?? ORDENES.codigo;
      valores.push(filtros.limite, filtros.desplazamiento);
      const r = await pool.query(
        `SELECT id, codigo, nombre, categoria, disponible
         FROM practica_prestamos.equipos
         ${where}
         ORDER BY ${ordenSQL}
         LIMIT $${valores.length - 1} OFFSET $${valores.length}`,
        valores
      );
      return r.rows;
    },

    async categorias() {
      const r = await pool.query(
        `SELECT DISTINCT categoria FROM practica_prestamos.equipos
         ORDER BY categoria`
      );
      return r.rows.map(fila => fila.categoria);
    },

    // Datos del equipo y, si existe, el préstamo activo (LEFT JOIN)
    async buscarDetalle(id) {
      const r = await pool.query(
        `SELECT e.id, e.codigo, e.nombre, e.categoria, e.disponible,
                u.nombre AS usuario_actual, p.fecha_prestamo AS prestado_desde
         FROM practica_prestamos.equipos AS e
         LEFT JOIN practica_prestamos.prestamos AS p
           ON p.equipo_id = e.id AND p.fecha_devolucion IS NULL
         LEFT JOIN practica_prestamos.usuarios AS u ON u.id = p.usuario_id
         WHERE e.id = $1`,
        [id]
      );
      return r.rows[0] ?? null;
    },

    async historial(id) {
      const r = await pool.query(
        `SELECT p.id, u.nombre AS usuario, p.fecha_prestamo, p.fecha_devolucion
         FROM practica_prestamos.prestamos AS p
         INNER JOIN practica_prestamos.usuarios AS u ON u.id = p.usuario_id
         WHERE p.equipo_id = $1
         ORDER BY p.fecha_prestamo DESC, p.id DESC`,
        [id]
      );
      return r.rows;
    },

    async crear({ codigo, nombre, categoria }) {
      const r = await pool.query(
        `INSERT INTO practica_prestamos.equipos(codigo, nombre, categoria)
         VALUES ($1, $2, $3)
         RETURNING id, codigo, nombre, categoria, disponible`,
        [codigo, nombre, categoria]
      );
      return r.rows[0];
    },

    // No modifica disponible: eso solo cambia al prestar o devolver.
    async actualizar(id, { codigo, nombre, categoria }) {
      const r = await pool.query(
        `UPDATE practica_prestamos.equipos
         SET codigo = $1, nombre = $2, categoria = $3
         WHERE id = $4
         RETURNING id, codigo, nombre, categoria, disponible`,
        [codigo, nombre, categoria, id]
      );
      return r.rowCount === 0 ? null : r.rows[0];
    },

    // Devuelve true si borró la fila. Si tiene préstamos, la FK lanza 23503.
    async eliminar(id) {
      const r = await pool.query(
        'DELETE FROM practica_prestamos.equipos WHERE id = $1',
        [id]
      );
      return r.rowCount > 0;
    }
  };
}
