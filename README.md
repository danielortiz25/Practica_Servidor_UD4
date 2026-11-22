# Práctica DWES UD4 · Gestión de préstamos de material informático

Aplicación Express + EJS que mantiene un inventario de equipos y registra préstamos y devoluciones sobre PostgreSQL, usando SQL directo con `pg`, consultas parametrizadas, restricciones y transacciones.

## Requisitos

- Node.js 24
- Docker Desktop (o el servicio Docker) con `docker compose`
- Dependencias: Express 5, pg 8 y EJS 3 (se instalan con npm)

## Estructura

```
practica-prestamos/
  infra-postgres/
    compose.yaml          PostgreSQL 18 con volumen persistente
    .env.example          Clave del administrador (copiar a .env)
  init.sql                Esquema practica_prestamos, restricciones y datos de ejemplo
  .env.example            Conexión de la aplicación (copiar a .env)
  package.json
  pruebas.mjs             Comprobaciones con fetch y consultas a la base
  src/
    server.mjs            Rutas Express, validación, errores, arranque y cierre
    db.mjs                Comprobación de la configuración y creación del pool
    equipos.repo.mjs      Consultas SQL de equipos (listado, detalle, alta, cambio, borrado)
    prestamos.service.mjs Transacciones de préstamo y devolución
  views/
    equipos.ejs           Listado con filtros y paginación
    equipo.ejs            Detalle e historial de préstamos
```

## Instalación y arranque

### 1. Iniciar PostgreSQL en Docker

```bash
cd infra-postgres
cp .env.example .env          # escribe tu clave de administrador (sin espacios, # ni $)
docker compose up -d
docker compose ps             # espera a que aparezca healthy
```

### 2. Crear el usuario de la aplicación (solo una vez)

Si ya tienes `dwes_app` de las sesiones del curso, sáltate este paso.

```bash
docker compose exec db psql -U postgres -d dwes
```

```sql
CREATE ROLE dwes_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password dwes_app
GRANT CONNECT, CREATE ON DATABASE dwes TO dwes_app;
\q
```

### 3. Inicializar la base

Abre psql como `dwes_app` y pega el contenido completo de `init.sql`:

```bash
docker compose exec db psql -h 127.0.0.1 -U dwes_app -d dwes -W
```

`init.sql` crea el esquema `practica_prestamos` si no existe y reinicia sus datos (`TRUNCATE ... RESTART IDENTITY`). Repítelo antes de cada tanda de pruebas para partir de un estado conocido. Solo afecta a este esquema.

### 4. Arrancar Node.js

Desde la carpeta raíz del proyecto:

```bash
npm install
cp .env.example .env          # pon la contraseña real de dwes_app
npm start                     # node --env-file=.env src/server.mjs
```

Debe aparecer `Conexión comprobada: 1` y después `HTTP preparado`. Abre http://127.0.0.1:3000/equipos.

Para parar: `Ctrl+C` en Node y `docker compose stop` en `infra-postgres`. `docker compose down -v` borra el volumen y todos los datos.

## Modelo de datos

| Tabla | Campos | Restricciones |
|---|---|---|
| `equipos` | id, codigo, nombre, categoria, disponible | `id` identidad (PK); `codigo` NOT NULL, UNIQUE (`equipos_codigo_unico`), CHECK de 1 a 20 caracteres; `nombre` y `categoria` NOT NULL con CHECK que impide valores vacíos o solo espacios; `disponible` boolean NOT NULL DEFAULT true |
| `usuarios` | id, nombre | PK; `nombre` NOT NULL y no vacío |
| `prestamos` | id, equipo_id, usuario_id, fecha_prestamo, fecha_devolucion | `id` identidad (PK); FK a equipos (`prestamos_equipo_fk`) y a usuarios (`prestamos_usuario_fk`) sin `ON DELETE CASCADE`; `fecha_prestamo` DEFAULT now(); CHECK de devolución posterior al préstamo |

El índice `un_prestamo_activo` (UNIQUE parcial sobre `equipo_id` cuando `fecha_devolucion IS NULL`) impide dos préstamos activos del mismo equipo y deja guardar todo el historial.

### Datos iniciales

- 3 usuarios: 1 Ana García, 2 Luis Pérez, 3 Marta Ruiz.
- 12 equipos en 6 categorías (portatil, tableta, proyector, camara, auriculares, periferico), con ids del 1 al 12 en el orden de `init.sql`.
- POR-002 tiene un préstamo ya devuelto (sirve para comprobar que no se puede borrar).
- PRO-001 tiene un préstamo activo de Luis Pérez y está marcado como no disponible.

## Rutas

### Vistas HTML

| Ruta | Descripción |
|---|---|
| `GET /equipos` | Tabla con código, nombre, categoría y estado. Parámetros GET: `q` (búsqueda parcial por nombre con ILIKE), `categoria`, `disponible` (`si`/`no`), `orden` (`codigo`/`nombre`), `pagina`. 5 equipos por página; los enlaces Anterior/Siguiente conservan los filtros. Devuelve 400 si algún filtro no es válido. |
| `GET /equipos/:id` | Datos del equipo, usuario que lo tiene prestado ahora (LEFT JOIN) e historial de préstamos (JOIN). 400 si el id está mal formado; 404 si no existe. |

### API JSON

| Método y ruta | Cuerpo | Respuestas |
|---|---|---|
| `POST /api/equipos` | `{ codigo, nombre, categoria }` | 201 + equipo + `Location`; 400 datos inválidos; 409 `CODIGO_DUPLICADO` |
| `PUT /api/equipos/:id` | `{ codigo, nombre, categoria }` | 200 + equipo; 400; 404; 409 código repetido |
| `DELETE /api/equipos/:id` | — | 204; 404; 409 `TIENE_PRESTAMOS` |
| `POST /api/prestamos` | `{ equipoId, usuarioId }` | 201 + préstamo; 400 `USUARIO_INEXISTENTE`; 409 `NO_DISPONIBLE` |
| `POST /api/prestamos/:id/devolucion` | — | 200 + préstamo devuelto; 409 `NO_ACTIVO` |

El `codigo` admite letras mayúsculas, números y guiones (1–20). El nombre tiene 1–80 caracteres y la categoría 1–40, una vez quitados los espacios. Un JSON mal formado devuelve 400 y un cuerpo de más de 10 kB devuelve 413. Cualquier otro fallo devuelve 500 con un mensaje genérico.

Ejemplo con curl:

```bash
curl -i -X POST http://127.0.0.1:3000/api/prestamos \
  -H "Content-Type: application/json" \
  -d '{"equipoId":1,"usuarioId":1}'
```

## Decisiones de implementación

- **Consultas parametrizadas**: todos los valores del cliente (filtros, ids, límite, desplazamiento, datos de escritura) viajan como `$1`, `$2`… La ordenación traduce `codigo`/`nombre` a fragmentos fijos (`codigo, id` / `nombre, id`); nunca se concatena el texto recibido. Los filtros se combinan con `AND` en el `WHERE` y cada uno añade su propio parámetro.
- **Paginación**: se piden 6 filas (tamaño + 1) para saber si hay página siguiente sin hacer un `COUNT`, como en el ejemplo C.
- **Escritura**: `INSERT ... RETURNING` para devolver el equipo creado; `UPDATE`/`DELETE ... WHERE id=$n` comprobando `rowCount` para dar 404. `PUT` no toca `disponible`.
- **Préstamo**: en una transacción con un único cliente (`pool.connect`), un `UPDATE ... WHERE id=$1 AND disponible=true`; si `rowCount` es 0 se lanza `NO_DISPONIBLE` y se hace ROLLBACK. Si no, se inserta el préstamo. Si el usuario no existe, la FK falla y el ROLLBACK deshace el UPDATE. Solo se hace COMMIT si las dos escrituras van bien.
- **Devolución**: `UPDATE prestamos ... WHERE id=$1 AND fecha_devolucion IS NULL RETURNING equipo_id` y, en la misma transacción, `disponible=true`. El cliente se libera siempre en `finally`.
- **Errores**: se distinguen por SQLSTATE y por el nombre de la restricción (`23505` → 409, `23503` → 400 o 409 según la FK, `23502`/`23514` → 400). Nunca se envía el mensaje de PostgreSQL al cliente.
- **Simultaneidad**: el UPDATE condicional decide quién gana. Con Read Committed, la segunda transacción espera el bloqueo, vuelve a evaluar la condición y afecta a 0 filas. El índice único parcial es una segunda barrera dentro de la base.

## Pruebas realizadas

Con la base recién inicializada (`init.sql`) y el servidor arrancado, en otra terminal:

```bash
npm run pruebas               # node --env-file=.env pruebas.mjs
```

El script hace las peticiones con `fetch`, consulta las tablas con el mismo pool para comprobar el estado real y muestra una tabla con lo esperado, lo obtenido y OK/FALLO. Los filtros y la paginación se revisan además a mano en el navegador.

| Caso | Petición | Esperado | Obtenido |
|---|---|---|---|
| Alta | `POST /api/equipos` TEST-01 | 201 + Location | 201, Location `/api/equipos/13` ✔ |
| Modificación | `PUT /api/equipos/13` | 200 | 200 ✔ |
| Modificación inexistente | `PUT /api/equipos/999999` | 404 | 404 ✔ |
| Código repetido | `POST /api/equipos` TEST-01 otra vez | 409 | 409 ✔ |
| Validación | `POST` con nombre vacío / JSON mal formado | 400 / 400 | 400 / 400 ✔ |
| Búsqueda ILIKE | `GET /equipos?q=PORT` | 200 | 200 ✔ |
| Categoría + disponibilidad + orden | `GET /equipos?categoria=tableta&disponible=si&orden=nombre` | 200 | 200 ✔ |
| Segunda página | `GET /equipos?pagina=2` | 200 | 200 ✔ |
| Filtro no válido | `GET /equipos?pagina=0` / orden no permitido | 400 / 400 | 400 / 400 ✔ |
| Detalle | `GET /equipos/abc` / `GET /equipos/999999` | 400 / 404 | 400 / 404 ✔ |
| Borrado sin historial | `DELETE /api/equipos/13` | 204 | 204 ✔ |
| Borrado inexistente | `DELETE /api/equipos/999999` | 404 | 404 ✔ |
| Borrado con préstamos | `DELETE /api/equipos/2` (POR-002) | 409 | 409 ✔ |
| Préstamo correcto | `POST /api/prestamos` POR-001, usuario 1 | 201; disponible=false; 1 activo | 201; false/1 ✔ |
| Préstamo duplicado | Mismo equipo otra vez | 409; sigue habiendo 1 fila | 409; 1 fila ✔ |
| Rollback | POR-003 con usuario 999 | 400; disponible=true; 0 préstamos | 400; true/0 ✔ |
| Devolución | `POST /api/prestamos/3/devolucion` | 200; fecha registrada; disponible=true | 200; true/true ✔ |
| Segunda devolución | Mismo préstamo | 409; fecha sin cambios | 409; fecha sin cambios ✔ |
| Devolución inexistente | `POST /api/prestamos/999999/devolucion` | 409 | 409 ✔ |
| Simultaneidad | Dos préstamos de POR-004 con `Promise.all` | Un 201 y un 409; 1 préstamo activo | 201 y 409; 1 activo ✔ |

Resultado de `npm run pruebas` (ejecutado en GitHub Codespaces con PostgreSQL 18 en Docker): **30 de 30 comprobaciones OK**.

## Limitaciones conocidas

- `POST /api/prestamos` devuelve 409 `NO_DISPONIBLE` tanto si el equipo está prestado como si no existe. Es la misma simplificación del ejemplo F de la sesión 14; distinguir el 404 obligaría a hacer una comprobación aparte.
- La devolución de un préstamo inexistente y la de uno ya devuelto dan la misma respuesta (409 `NO_ACTIVO`).
- `usuarioId` llega en el cuerpo porque no hay autenticación. En una aplicación real habría que sacarlo de la identidad autenticada o comprobar la autorización.
- La búsqueda deja usar los comodines `%` y `_` de ILIKE dentro del texto buscado.
- La paginación por OFFSET puede mover registros entre páginas si alguien inserta o borra mientras se navega.
- No hay interfaz para altas, préstamos ni devoluciones: se hacen con la API (script, curl o un cliente HTTP).
