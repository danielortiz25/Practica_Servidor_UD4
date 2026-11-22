-- Práctica: gestión de préstamos de material informático
-- Ejecutar como dwes_app en la base dwes.
-- Reinicia SOLO los datos del esquema practica_prestamos.

CREATE SCHEMA IF NOT EXISTS practica_prestamos;

CREATE TABLE IF NOT EXISTS practica_prestamos.equipos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo text NOT NULL
    CONSTRAINT equipos_codigo_unico UNIQUE
    CHECK (char_length(codigo) BETWEEN 1 AND 20),
  nombre text NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 1 AND 80),
  categoria text NOT NULL CHECK (char_length(btrim(categoria)) BETWEEN 1 AND 40),
  disponible boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS practica_prestamos.usuarios (
  id integer PRIMARY KEY,
  nombre text NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 1 AND 80)
);

CREATE TABLE IF NOT EXISTS practica_prestamos.prestamos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipo_id integer NOT NULL
    CONSTRAINT prestamos_equipo_fk REFERENCES practica_prestamos.equipos(id),
  usuario_id integer NOT NULL
    CONSTRAINT prestamos_usuario_fk REFERENCES practica_prestamos.usuarios(id),
  fecha_prestamo timestamptz NOT NULL DEFAULT now(),
  fecha_devolucion timestamptz,
  CHECK (fecha_devolucion IS NULL OR fecha_devolucion >= fecha_prestamo)
);

-- Solo un préstamo activo por equipo (los históricos no cuentan)
CREATE UNIQUE INDEX IF NOT EXISTS un_prestamo_activo
ON practica_prestamos.prestamos(equipo_id)
WHERE fecha_devolucion IS NULL;

-- Datos de ejemplo
TRUNCATE practica_prestamos.prestamos,
  practica_prestamos.equipos, practica_prestamos.usuarios
RESTART IDENTITY;

INSERT INTO practica_prestamos.usuarios VALUES
  (1, 'Ana García'), (2, 'Luis Pérez'), (3, 'Marta Ruiz');

INSERT INTO practica_prestamos.equipos(codigo, nombre, categoria) VALUES
  ('POR-001', 'Portátil Lenovo ThinkPad E14', 'portatil'),
  ('POR-002', 'Portátil HP ProBook 450', 'portatil'),
  ('POR-003', 'Portátil Dell Latitude 5440', 'portatil'),
  ('POR-004', 'Portátil Acer TravelMate P2', 'portatil'),
  ('TAB-001', 'Tableta Samsung Galaxy Tab A8', 'tableta'),
  ('TAB-002', 'Tableta iPad 10.ª generación', 'tableta'),
  ('TAB-003', 'Tableta Lenovo Tab M10', 'tableta'),
  ('PRO-001', 'Proyector Epson EB-W51', 'proyector'),
  ('PRO-002', 'Proyector BenQ MW560', 'proyector'),
  ('CAM-001', 'Cámara web Logitech C920', 'camara'),
  ('AUR-001', 'Auriculares Jabra Evolve2 30', 'auriculares'),
  ('RAT-001', 'Ratón inalámbrico Logitech M185', 'periferico');

-- Un préstamo ya devuelto (POR-002) y uno activo (PRO-001)
INSERT INTO practica_prestamos.prestamos
  (equipo_id, usuario_id, fecha_prestamo, fecha_devolucion)
VALUES
  ((SELECT id FROM practica_prestamos.equipos WHERE codigo = 'POR-002'), 1,
   now() - interval '10 days', now() - interval '7 days'),
  ((SELECT id FROM practica_prestamos.equipos WHERE codigo = 'PRO-001'), 2,
   now() - interval '1 day', NULL);

UPDATE practica_prestamos.equipos SET disponible = false
WHERE codigo = 'PRO-001';
