// Servicio de préstamos: operaciones transaccionales con un único cliente.
function fallo(codigo) { return Object.assign(new Error(codigo), { codigo }); }

export function crearServicioPrestamos(pool) {
  async function transaccion(trabajo) {
    const cliente = await pool.connect();
    let descartar = false;
    try {
      await cliente.query('BEGIN');
      const resultado = await trabajo(cliente);
      await cliente.query('COMMIT');
      return resultado;
    } catch (error) {
      try { await cliente.query('ROLLBACK'); }
      catch { descartar = true; }
      throw error;
    } finally {
      cliente.release(descartar);
    }
  }

  return {
    async prestar(equipoId, usuarioId) {
      return transaccion(async cliente => {
        // 1. Actualización condicional: solo si está disponible
        const cambio = await cliente.query(
          `UPDATE practica_prestamos.equipos
           SET disponible = false
           WHERE id = $1 AND disponible = true
           RETURNING id`, [equipoId]);
        if (cambio.rowCount === 0) throw fallo('NO_DISPONIBLE');
        // 2. Inserción del préstamo (la FK comprueba que el usuario existe)
        const r = await cliente.query(
          `INSERT INTO practica_prestamos.prestamos(equipo_id, usuario_id)
           VALUES ($1, $2)
           RETURNING id, equipo_id, usuario_id, fecha_prestamo`,
          [equipoId, usuarioId]);
        return r.rows[0];
      });
    },

    async devolver(prestamoId) {
      return transaccion(async cliente => {
        // 1. Cerrar el préstamo solo si sigue activo
        const r = await cliente.query(
          `UPDATE practica_prestamos.prestamos
           SET fecha_devolucion = now()
           WHERE id = $1 AND fecha_devolucion IS NULL
           RETURNING id, equipo_id, usuario_id, fecha_prestamo, fecha_devolucion`,
          [prestamoId]);
        if (r.rowCount === 0) throw fallo('NO_ACTIVO');
        // 2. Liberar el equipo en la misma transacción
        await cliente.query(
          `UPDATE practica_prestamos.equipos SET disponible = true
           WHERE id = $1`, [r.rows[0].equipo_id]);
        return r.rows[0];
      });
    }
  };
}
