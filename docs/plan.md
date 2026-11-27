# Sistema de Evaluación Escolar — Plan del proyecto

Nov 24, 2026 · @Emmanuel Figueroa Pérez

## 1. Resumen

Vamos a construir en **8 días hábiles (del miércoles 25 de noviembre al viernes 4 de diciembre de 2026)** un sistema web, pensado primero para el celular. En él, cada maestro captura sus actividades, calificaciones, exámenes y observaciones del día. Las calificaciones de cada campo formativo se calculan solas con las mismas reglas del Excel actual de la maestra Viry, y al cerrar el periodo las boletas de todo el grupo se imprimen en un clic. El director consulta todo en modo lectura, y cada padre o tutor ve el avance de sus hijos.

**Objetivos de la versión 1**

- Que el cierre de periodo baje de varias tardes (capturas de pantalla + Word) a **menos de 15 minutos por grupo**.
- Una sola fuente de verdad: lo que el maestro captura es exactamente lo que calcula la boleta, sin copiar y pegar.
- Resultados idénticos al Excel: las 80 calificaciones del Periodo I del 5°B (20 alumnos × 4 campos) se usan como pruebas automáticas del motor de cálculo.
- Uso cómodo en un celular de gama media con datos móviles. Las pantallas se diseñan primero para 360 px de ancho.
- Que los datos de los alumnos solo los vea quien debe verlos (ver sección 7).

**Dentro del alcance (v1):** varios maestros y grupos en una escuela; roles de admin, director, maestro y padre/tutor; captura diaria; promedios en vivo y alertas; ajustes, observaciones y boletas en PDF y Word; portal de padres; importación del Excel actual; historial por periodo; bitácora de cambios.

**Fuera del alcance (v1):** la boleta oficial de la SEP (SIGED), app nativa de tienda, asistencia, mensajería o chat con padres, pagos y captura sin conexión completa. El sistema queda preparado para varias escuelas, pero en la v1 solo se opera una.

**Nota sobre el stack:** pediste NestJS + React + MongoDB y que yo eligiera las librerías. No tengo acceso a sus proyectos anteriores, así que elegí lo que mejor funciona hoy con ese stack (sección 3). Si en sus otros proyectos usan algo distinto (por ejemplo MUI en vez de Tailwind), se cambia en el `CLAUDE.md` de la etapa 0 antes de arrancar.

## 2. Roles y permisos

Hay cuatro roles. Cada usuario puede tener uno o varios (un director que también da clase tiene `DIRECTOR` + `TEACHER`). Los permisos se revisan siempre en el backend; el frontend solo oculta botones.

| Acción | Admin | Director | Maestro | Padre / tutor |
| --- | --- | --- | --- | --- |
| Crear y administrar usuarios, roles, escuela, ciclos y periodos | Sí | Sí, salvo admins y reglas de cálculo (cambio pedido el 27 nov) | No | No |
| Crear grupos y asignarles maestros | Sí | Sí | No | No |
| Crear alumnos e inscripciones; importar Excel | Sí | No | No | No |
| Ver grupos, actividades, calificaciones y observaciones | Todo | Toda su escuela | Solo sus grupos asignados | Solo sus hijos, lo publicado |
| Crear y editar actividades y calificaciones | Sí | Solo con permiso del admin | Sus grupos, periodo abierto | No |
| Notas diarias del alumno | Sí | Lectura (edición con permiso) | Crear y editar las suyas | Ve las marcadas "visible para padres" |
| Ajustes de calificación (`*`) y observaciones de periodo | Sí | Solo con permiso | Sus grupos, antes de cerrar | Ve lo publicado |
| Cerrar periodo y publicar boletas | Sí | Sí | Pide el cierre de sus grupos | No |
| Reabrir un periodo cerrado | Sí | Sí | No | No |
| Imprimir o descargar boletas (PDF/Word) | Sí | Sí | Sus grupos | La de su hijo, ya publicada |
| Crear cuentas de padres y vincularlas con alumnos | Sí | Sí | Sí, de sus alumnos | No |
| Ver bitácora de cambios | Sí | Sí | Solo de sus grupos | No |

**Permisos especiales (otorgados por el admin).** El admin puede darle a un director, o a cualquier usuario, un permiso de edición puntual. Se guarda en `permissionGrants` con estas partes: acción (por ejemplo `grade:update`), alcance (toda la escuela o un grupo), fecha de vencimiento opcional y quién lo otorgó. Al vencer, el permiso deja de aplicar sin que nadie lo quite.

**Maestros de materia.** Inglés y Educación Física entran a la calificación de Lenguajes y De lo humano (30%). Un maestro puede estar asignado a un grupo completo (titular) o solo a una materia (`teachingAssignments.scope`). El de Inglés solo ve y captura Inglés de ese grupo.

**Padres y tutores.** El maestro titular (o la dirección) crea la cuenta del padre o tutor desde el alumno, con nombre, teléfono, domicilio y parentesco. El teléfono identifica a la familia: si ya está registrado con otro alumno de la escuela, el nuevo hijo se vincula a la misma cuenta. El padre recibe un usuario (`TUT26-0001`) y una contraseña temporal que cambia en su primer ingreso, cuando acepta el aviso de privacidad. Solo ve:

- Actividades y calificaciones que el maestro marcó como visibles. Por defecto son visibles 24 horas después de capturarse, para dar tiempo a corregir.
- Notas marcadas "visible para padres".
- Calificaciones de periodo y boleta, solo cuando el periodo está publicado.

Nunca ve a otros alumnos, promedios del grupo ni comparativos con compañeros.

## 3. Arquitectura y stack

El proyecto es un monorepo en TypeScript con tres partes: la API en NestJS, la web en React y un paquete compartido. Ese paquete lleva los tipos, las validaciones, los permisos y el motor de cálculo, para que backend y frontend calculen exactamente igual.

&#91;embedded content: arquitectura · web, API, paquete compartido y servicios\]

El navegador nunca habla con la base de datos. Las reglas de permisos y de cálculo se escriben una sola vez en `shared` y las usan tanto la web como la API.

```text
sistema-evaluacion/
├─ apps/
│  ├─ api/            NestJS: módulos por dominio (auth, users, schools, groups, students,
│  │                  activities, grades, notes, periods, reports, imports, audit)
│  └─ web/            React + Vite: rutas por rol (/maestro, /director, /padres, /admin)
├─ packages/
│  └─ shared/         esquemas zod, tipos, enums, motor de cálculo, reglas CASL
├─ docs/plan.md       este documento exportado a Markdown
├─ docker-compose.yml Mongo (réplica de 1 nodo) + api + web para desarrollo
└─ CLAUDE.md          convenciones para Claude Code
```

| Capa | Elección | Por qué |
| --- | --- | --- |
| Monorepo | pnpm workspaces + Turborepo | Un solo `pnpm dev`; el paquete `shared` se usa en api y web sin publicarlo |
| Backend | NestJS 11, Node 22 LTS | El stack pedido; módulos claros por dominio |
| Base de datos | MongoDB 7 (Atlas) con Mongoose 8 + `@nestjs/mongoose` | Atlas es un replica set: permite transacciones al cerrar periodo |
| Validación | zod + `nestjs-zod` | El mismo esquema valida en el formulario y en la API |
| Autenticación | `@nestjs/jwt`, argon2, refresh token en cookie httpOnly | Sesiones seguras sin guardar tokens en el navegador |
| Permisos | `@casl/ability` (reglas en `shared`) | Las mismas reglas deciden en la API y ocultan botones en la web |
| Documentación API | `@nestjs/swagger` en `/api/docs` | Contrato visible para frontend y pruebas |
| Protección | helmet, `@nestjs/throttler`, CORS cerrado | Límite de intentos en login y cabeceras seguras |
| Logs y errores | `nestjs-pino` + Sentry | Logs estructurados sin datos personales; alertas de errores |
| Boletas PDF | Puppeteer (plantilla HTML → PDF) | El PDF sale idéntico a la vista previa de la web |
| Boletas Word | `docx` (npm) | Word editable, como el que ya aprobó la maestra |
| Importar/exportar Excel | ExcelJS | Lee el Excel actual del 5°B y exporta concentrados |
| Correo | Resend (o SMTP con Nodemailer) | Invitaciones y recuperación de contraseña |
| Frontend | React 19 + Vite + TypeScript | El stack pedido; arranque rápido |
| Rutas | React Router 7 | Rutas anidadas por rol con protección |
| Datos del servidor | TanStack Query 5 | Caché, reintentos y actualización optimista al capturar |
| Formularios | React Hook Form + zod | Validación inmediata con el esquema compartido |
| UI | Tailwind CSS 4 + shadcn/ui (Radix) + lucide-react | Componentes accesibles y livianos, fáciles de adaptar al celular |
| Gráficas | Recharts | Avance por campo y comparativo entre periodos |
| PWA | `vite-plugin-pwa` | Se instala en el celular como app y carga rápido |
| Fechas | date-fns con locale `es` y zona `America/Mexico_City` | Fechas en español y sin desfases de un día |
| Pruebas | Jest + Supertest + mongodb-memory-server (api), Vitest (shared, web), Playwright (e2e) | Motor de cálculo y permisos cubiertos antes de salir |
| Despliegue | Docker; API en Railway o Render; web en Vercel; Atlas M10 | Sin servidores que administrar; HTTPS incluido |
| CI | GitHub Actions: lint, typecheck, tests, build | Cada PR de etapa se valida solo |

Los logos de la escuela y de cada maestro se guardan en MongoDB (GridFS), así no hace falta otro servicio de archivos. Las boletas no se guardan: se generan al momento desde los datos del periodo cerrado, para que siempre coincidan con lo capturado.

## 4. Modelo de datos (MongoDB)

Son 18 colecciones. Todas llevan `schoolId`, `createdAt`, `updatedAt` y `createdBy`, y las que se pueden borrar usan borrado lógico (`deletedAt`). Los ids son `ObjectId` y las fechas se guardan en UTC.

| Colección | Para qué | Campos principales | Índices |
| --- | --- | --- | --- |
| `schools` | Datos de la escuela | `name`, `shortName`, `cct`, `city`, `state`, `logoFileId` | — |
| `users` | Todas las personas que entran | `email`, `passwordHash`, `firstName`, `lastName`, `phone?`, `roles[]` (`ADMIN`, `DIRECTOR`, `TEACHER`, `GUARDIAN`), `status` (`INVITED`, `ACTIVE`, `DISABLED`), `avatarFileId?`, `lastLoginAt` | `email` único |
| `sessions` | Refresh tokens activos | `userId`, `tokenHash`, `userAgent`, `ip`, `expiresAt`, `revokedAt?` | `userId`; TTL en `expiresAt` |
| `schoolYears` | Ciclos escolares | `name` ("2026-2027"), `startDate`, `endDate`, `isCurrent` | `schoolId + name` único |
| `periods` | Periodos del ciclo | `schoolYearId`, `number` (1-3), `name`, `startDate`, `endDate`, `status` (`OPEN`, `IN_REVIEW`, `CLOSED`, `PUBLISHED`), `deliveryDate`, `deliveryDateText` | `schoolYearId + number` único |
| `gradingSchemes` | Reglas de cálculo por ciclo (sección 5) | `schoolYearId`, `fields[]` (campos formativos con pesos y materia complementaria), `rounding`, `lowThreshold`, `lowLegend`, `minFinal`, `maxFinal` | `schoolYearId` único |
| `groups` | Grupos | `schoolYearId`, `grade` (5), `letter` ("B"), `name` ("5°B"), `homeroomTeacherId` | `schoolYearId + name` único |
| `students` | Alumnos (permanente entre ciclos) | `firstName`, `lastName1`, `lastName2`, `curp?`, `birthDate?`, `notes?` | texto en nombre |
| `enrollments` | Alumno en un grupo y ciclo | `studentId`, `groupId`, `listNumber` (N/L), `status` (`ACTIVE`, `TRANSFERRED`, `WITHDRAWN`), `from`, `to?` | `groupId + listNumber`; `studentId + schoolYearId` único |
| `teachingAssignments` | Qué enseña cada maestro | `teacherId`, `groupId`, `scope` (`HOMEROOM` o `SUBJECT`), `subjectKey?` (`ingles`, `ed_fisica`) | `teacherId + groupId` |
| `guardianLinks` | Padre o tutor ↔ alumno | `guardianUserId`, `studentId`, `relationship` (madre, padre, tutor…), `status`, `inviteId` | `guardianUserId + studentId` único |
| `invitations` | Códigos de alta | `type` (`STAFF` o `GUARDIAN`), `codeHash`, `email?`, `studentId?`, `roles[]`, `expiresAt`, `usedAt?` | `codeHash` único; TTL |
| `activities` | Lo que se califica | `groupId`, `periodId`, `fieldKey` (`lenguajes`, `saberes`, `etica`, `humano`), `component` (`DESEMPENO`, `PROYECTO`, `EXAMEN`, `COMPLEMENTARIA`), `subjectKey?`, `name`, `date`, `medium?` (libreta, hoja…), `description?`, `visibleToGuardians`, `visibleFrom` | `groupId + periodId + fieldKey + component` |
| `grades` | Calificación de un alumno en una actividad | `activityId`, `studentId`, `status` (`SCORED`, `NOT_DELIVERED`, `EXCUSED`), `score?` (0-10, un decimal), `comment?` | `activityId + studentId` único; `studentId + periodId` |
| `studentNotes` | Observaciones del día a día | `studentId`, `groupId`, `periodId`, `authorId`, `date`, `fieldKey?`, `kind` (`ACADEMICO`, `CONDUCTA`, `RECONOCIMIENTO`, `SALUD`, `OTRO`), `text`, `visibleToGuardians` | `studentId + date` |
| `periodResults` | Cierre por alumno y periodo | `periodId`, `groupId`, `studentId`, `fields[]` {`fieldKey`, `components` (D, P, E, complementaria), `calculated`, `rounded`, `override?`, `overrideReason?`, `final`}, `generalAverage`, `observations` {`general?`, `byField` {lenguajes…}}, `legendOverride?`, `legendSuggested`, `snapshotAt` | `periodId + studentId` único |
| `permissionGrants` | Permisos especiales | `userId`, `action`, `scope` {`type`: `SCHOOL` o `GROUP`, `groupId?`}, `expiresAt?`, `grantedBy`, `reason` | `userId` |
| `auditLogs` | Bitácora de cambios | `actorId`, `action`, `entity`, `entityId`, `before`, `after`, `at`, `ip` | `entity + entityId`; `at` |

**Diferencia entre vacío y cero.** El Excel distinguía "no entregó" (0) de "no aplica" (vacío), y por eso a un alumno le bajó un promedio cuando una celda vacía contó como 0. En el sistema cada calificación tiene un estado explícito:

- `NOT_DELIVERED` cuenta como 0.
- `EXCUSED` no cuenta.
- Si un alumno no tiene registro en una actividad, está **pendiente**: no cuenta y aparece como alerta.

**Foto al cerrar.** Al cerrar un periodo se guarda en `periodResults` una copia de los promedios calculados. Así, una boleta ya entregada no cambia aunque después se edite una actividad; para cambiarla hay que reabrir el periodo (solo el admin) y queda en la bitácora.

## 5. Reglas de cálculo

El motor reproduce exactamente el Excel del 5°B. Vive en `packages/shared/grading` como funciones puras, sin acceso a la base de datos, y se prueba con las 80 calificaciones reales del Periodo I antes de conectarlo a nada.

**Paso 1. Promedio de cada componente** (desempeño, proyectos, exámenes, materia complementaria): es el promedio simple de las actividades de ese componente, en ese campo y periodo. Cuentan las calificaciones `SCORED` y las `NOT_DELIVERED` (como 0). No cuentan las `EXCUSED` ni las pendientes. En Saberes hay dos exámenes, Matemáticas y Ciencias, y se promedian igual que cualquier otro componente con dos actividades.

**Paso 2. Calificación del campo:**

```latex
C_{campo} = 0.5\,D + 0.2\,P + 0.3\,E
```

En Lenguajes (con Inglés) y De lo humano (con Educación Física):

```latex
C_{final} = 0.7\,C_{campo} + 0.3\,M_{complementaria}
```

**Paso 3. Redondeo:** primero a 4 decimales, para evitar errores de punto flotante, y después al entero con .5 hacia arriba. Por ejemplo, 9.4999999 → 9.5 → 10.

**Paso 4. Ajuste del maestro:** puede poner otra calificación entre 5 y 10, con un motivo opcional. La boleta usa el ajuste y lo marca con `*`.

**Paso 5. Promedio general:** el promedio de las 4 calificaciones finales, con un decimal.

**Paso 6. Leyenda "Ojo en":** lista los campos cuya calificación calculada es menor a 7 (`lowThreshold`). El texto (`lowLegend`) y el umbral se configuran, y el maestro puede reemplazar la leyenda de un alumno.

**Componentes incompletos.** Si a un campo le falta un componente completo (por ejemplo, aún no hay examen), la vista en vivo muestra un **promedio parcial** con los pesos repartidos entre lo que sí hay, marcado "parcial". El periodo no se puede cerrar mientras haya campos incompletos o calificaciones pendientes, salvo que el maestro las marque `EXCUSED`.

**Ejemplo real** (Aguilar Cárdenas Edgar Mateo, Periodo I):

- Lenguajes: D 8.8, P 9.125, E 8.0 → campo 8.625 → 0.7 × 8.625 + 0.3 × 10 (Inglés) = **9.0375 → 9**.
- De lo humano: D 8.1, P 8.875, E 9.5 → campo 8.675 → 0.7 × 8.675 + 0.3 × 10 (Ed. Física) = 9.0725 → 9, ajustado por la maestra a **10\***.

Todo esto se configura por ciclo escolar en `gradingSchemes`. Para cambiar porcentajes no hay que tocar código:

```json
{
  "fields": [
    { "key": "lenguajes", "name": "Lenguajes", "color": "#F8CBAD", "order": 1,
      "weights": { "DESEMPENO": 0.5, "PROYECTO": 0.2, "EXAMEN": 0.3 },
      "complementary": { "subjectKey": "ingles", "name": "Inglés", "fieldWeight": 0.7, "subjectWeight": 0.3 } },
    { "key": "saberes", "name": "Saberes y pensamiento científico", "color": "#9BC2E6", "order": 2,
      "weights": { "DESEMPENO": 0.5, "PROYECTO": 0.2, "EXAMEN": 0.3 } },
    { "key": "etica", "name": "Ética, naturaleza y sociedades", "color": "#A9D08E", "order": 3,
      "weights": { "DESEMPENO": 0.5, "PROYECTO": 0.2, "EXAMEN": 0.3 } },
    { "key": "humano", "name": "De lo humano y lo comunitario", "color": "#B4A7D6", "order": 4,
      "weights": { "DESEMPENO": 0.5, "PROYECTO": 0.2, "EXAMEN": 0.3 },
      "complementary": { "subjectKey": "ed_fisica", "name": "Educación Física", "fieldWeight": 0.7, "subjectWeight": 0.3 } }
  ],
  "rounding": { "preDecimals": 4, "mode": "HALF_UP" },
  "lowThreshold": 7,
  "lowLegend": "Ojo en:",
  "minFinal": 5,
  "maxFinal": 10
}
```

## 6. API y pantallas

La API es REST, está bajo `/api/v1`, responde en JSON y se documenta en `/api/docs`. Cada endpoint aplica el guard de JWT y la regla CASL correspondiente; las listas se paginan con `?page=&limit=`.

| Módulo | Endpoints principales | Roles |
| --- | --- | --- |
| auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/forgot`, `POST /auth/reset`, `POST /auth/accept-invite`, `GET /auth/me` | Público / todos |
| users | `GET/POST /users`, `PATCH /users/:id`, `POST /users/:id/disable`, `POST /users/:id/reset-password` | Admin |
| permission-grants | `GET/POST/DELETE /permission-grants` | Admin |
| school | `GET/PATCH /school`, `PUT /school/logo`, `GET /school/logo` | Admin (lectura: todos) |
| school-years / periods | `GET/POST /school-years`, `GET/POST/PATCH /periods`, `POST /periods/:id/close`, `POST /periods/:id/publish`, `POST /periods/:id/reopen` | Admin; maestro pide cierre de su grupo |
| grading-scheme | `GET/PUT /school-years/:id/grading-scheme` | Admin |
| groups | `GET/POST /groups`, `GET /groups/:id`, `GET /groups/:id/roster`, `POST /groups/:id/assignments` | Admin; maestro y director lectura |
| students | `GET/POST /students`, `PATCH /students/:id`, `POST /enrollments`, `PATCH /enrollments/:id` | Admin |
| invitations | `POST /invitations/guardian` (por alumno), `POST /invitations/staff`, `GET /invitations` | Admin, maestro (solo guardian) |
| imports | `POST /imports/excel/preview`, `POST /imports/excel/commit` | Admin |
| activities | `GET /groups/:id/activities?periodId&fieldKey`, `POST /activities`, `PATCH/DELETE /activities/:id` | Maestro, admin |
| grades | `GET /activities/:id/grades`, `PUT /activities/:id/grades` (lote: todos los alumnos de una vez), `GET /students/:id/grades?periodId` | Maestro, admin; director lectura |
| notes | `GET/POST /students/:id/notes`, `PATCH/DELETE /notes/:id`, `GET /groups/:id/notes?date` | Maestro, admin; director lectura |
| summary | `GET /groups/:id/summary?periodId` (promedios en vivo y alertas), `GET /students/:id/summary?periodId` | Maestro, director, admin |
| period-results | `GET /groups/:id/period-results?periodId`, `PATCH /period-results/:id` (ajustes, observaciones, leyenda) | Maestro, admin |
| reports | `GET /groups/:id/report-cards.pdf?periodId`, `GET /groups/:id/report-cards.docx?periodId`, `GET /students/:id/report-card.pdf?periodId`, `GET /groups/:id/capture-sheet.pdf?activityId` | Según rol (sección 2) |
| guardian | `GET /me/children`, `GET /me/children/:id/overview?periodId`, `GET /me/children/:id/activities`, `GET /me/children/:id/notes` | Padre / tutor |
| audit | `GET /audit?entity&entityId&from&to` | Admin, director |

**Pantallas por rol** (cada una se diseña primero para celular y después se amplía a tablet y computadora):

| Rol | Pantallas |
| --- | --- |
| Todos | Inicio de sesión, recuperar contraseña, aceptar invitación, mi perfil |
| Maestro | **Hoy** (sus grupos y actividades recientes) · **Nueva actividad** (campo, componente, nombre, fecha) · **Capturar calificaciones** (lista del grupo) · **Notas** del día · **Resumen del grupo** (promedios en vivo por campo, alertas) · **Ficha del alumno** · **Cierre de periodo** (ajustes, observaciones, leyenda, vista previa de boleta, imprimir) · Invitar padres |
| Director | Tablero de la escuela (grupos, avance de captura, alumnos con alertas) · ver cualquier grupo, alumno, actividad y boleta en solo lectura · bitácora de cambios |
| Padre / tutor | Mis hijos (tarjetas si son varios) · avance por campo con gráfica · actividades y calificaciones recientes · notas de la maestra · boletas publicadas para descargar |
| Admin | Usuarios y roles · permisos especiales · escuela y logos · ciclos, periodos y reglas de cálculo · grupos, alumnos e inscripciones · importar Excel · abrir, cerrar y publicar periodos · bitácora |

**La pantalla de captura es la más importante.** Se usa con una mano, con el papel en la otra:

- Lista del grupo en orden de N/L, una fila por alumno con el nombre corto y un campo numérico grande (`inputmode="decimal"`).
- Al dar "Siguiente" en el teclado salta al alumno de abajo, para vaciar la hoja de papel de corrido.
- Tres botones rápidos por fila: **NE** (no entregó = 0), **NA** (no aplica) y **10**.
- Se guarda sola cada 2 segundos o al salir del campo, con indicador "Guardado". Si se va la señal, guarda en el celular y reintenta.
- Valores fuera de 0 a 10 se rechazan en el momento: el 14 del Excel ya no podría capturarse.
- Contador "18 de 20 capturados" y los pendientes resaltados.
- Cada actividad tiene un botón **Hoja de captura**: imprime la lista del grupo con su N/L para anotar en papel durante la transición.

## 7. Seguridad y privacidad

El sistema guarda calificaciones y observaciones de menores de edad, así que la regla es: cada persona ve solo lo que su rol permite, y todo cambio deja rastro.

**Acceso**

- Contraseñas con argon2id; mínimo 10 caracteres.
- Access token JWT de 15 minutos, guardado solo en memoria. Refresh token de 30 días en cookie `httpOnly`, `Secure`, `SameSite=Strict`, que se rota en cada uso y se puede revocar desde "cerrar sesión en todos los dispositivos".
- Límite de 5 intentos de login por minuto por IP y correo; después, espera de 15 minutos.
- No hay registro abierto. Cada persona entra con un usuario que indica su tipo, el año y un consecutivo (`ADM26-0001`, `DIR26-0001`, `MAE26-0001`, `TUT26-0001`). La escuela crea las cuentas y entrega una contraseña temporal; mientras no la cambie, la cuenta solo puede cambiar su contraseña.
- Cada usuario edita su perfil (nombre, correo opcional, teléfono, domicilio y foto). Los alumnos no tienen foto.
- Las cuentas de padres se crean desde el alumno; el teléfono une a los hermanos en una sola cuenta.

**Autorización**

- Toda consulta se filtra en el backend por alcance: `schoolId`, grupos asignados o alumnos vinculados. Nunca se confía en ids que manda el frontend sin revisar el alcance.
- Hay pruebas automáticas de que un maestro no ve otro grupo y un padre no ve otro alumno. Si fallan, no se despliega.

**Datos y privacidad**

- Datos mínimos: nombre del alumno y lo académico. La CURP y la fecha de nacimiento son opcionales.
- Aviso de privacidad visible en el login y aceptación del padre al vincularse, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares. Antes de salir debe revisarlo la dirección de la escuela.
- Las notas tipo `SALUD` nunca son visibles para padres desde el sistema y solo las ven el maestro, el director y el admin.
- Cifrado en tránsito (HTTPS) y en reposo (Atlas). Respaldo diario de Atlas, guardado 7 días, más una exportación semanal.
- Los logs no guardan nombres ni calificaciones, solo ids. Sentry se configura sin datos personales.
- El sitio no se indexa en buscadores (`noindex`).

**Bitácora.** Se registra quién hizo qué, cuándo y el valor anterior y nuevo en: calificaciones, ajustes, observaciones de periodo, cierres y reaperturas, permisos y vínculos de padres. Sirve para resolver dudas ("¿quién cambió este 6 a 8?") y da confianza durante la transición desde el papel.

## 8. Plan por etapas

Son 7 etapas en 8 días hábiles. La salida a producción es el **viernes 4 de diciembre**, y el periodo II del 5°B ya se captura en el sistema. Para llegar, dos sesiones de Claude Code trabajan en paralelo desde el día 2. La sesión A lleva la línea principal (etapas 1 → 2 → 4 → 6). La sesión B lleva el motor de cálculo y los portales (etapas 3 → 5), que dependen menos del resto.

&#91;embedded content: calendario · 7 etapas en 8 días hábiles\]

La sesión B arranca el motor de cálculo el día 2 porque no depende de las pantallas. Las dos sesiones se juntan el jueves 3 para endurecer y salir a producción.

**Cómo trabajar cada etapa con Claude Code**

1. Antes de empezar, exporta este documento a Markdown y guárdalo como `docs/plan.md` en el repo. Todos los prompts lo citan.
2. Cada etapa va en su propia rama (`etapa-1-catalogos`, etc.); en paralelo, cada sesión usa su propio git worktree.
3. Pega el prompt de la etapa tal cual. Claude Code primero presenta un plan corto; revísalo y aprueba.
4. La etapa termina cuando pasan `pnpm lint`, `pnpm typecheck`, `pnpm test` y los criterios de aceptación de su sección, marcados con ☐ abajo. Después se abre un PR, se revisa y se hace merge a `main`.
5. Si una etapa se atrasa, se recorta lo marcado como "puede esperar" en esa etapa, nunca las pruebas del motor ni las de permisos.

**Qué se puede mover si el tiempo no alcanza** (en este orden): el comparativo entre periodos con gráficas (etapa 6), la exportación Word (queda solo PDF), la instalación como PWA y las alertas del tablero del director. Lo que **no** se mueve: captura, cálculo idéntico al Excel, permisos, boletas PDF y portal de padres en solo lectura.

## Etapa 0 — Cimientos (día 1, miércoles 25 nov)

Al terminar el día existe el repo con api, web y shared corriendo en local con un solo comando, login funcional con los 4 roles y despliegue de prueba en línea.

**Entregables:** monorepo, `docker-compose` con Mongo en réplica, `CLAUDE.md`, módulo de auth completo (login, refresh, logout, me, invitaciones de personal), reglas CASL base, layout responsivo con menú por rol, CI en GitHub Actions y despliegue de staging (Atlas + Railway/Render + Vercel). Incluye un script `seed` con la escuela, un admin, la directora y la maestra Viry.

**Criterios de aceptación**

- [ ] `pnpm i && pnpm dev` levanta api (:3000), web (:5173) y Mongo sin pasos manuales
- [ ] Login, refresh con rotación y logout funcionan; las pruebas e2e de auth pasan
- [ ] Cada rol entra a su inicio (`/admin`, `/director`, `/maestro`, `/padres`) y no puede abrir el de otro
- [ ] La web se ve bien a 360 px, 768 px y 1280 px
- [ ] CI en verde y staging accesible por HTTPS

```text
Eres el desarrollador principal de un sistema web de evaluación escolar para una primaria en Colima, México. Lee docs/plan.md completo antes de empezar: es la especificación. Hoy haces la ETAPA 0 — CIMIENTOS. No implementes nada de etapas posteriores.

Objetivo: monorepo listo, autenticación con 4 roles y staging en línea.

1. Monorepo con pnpm workspaces + Turborepo, Node 22, TypeScript estricto:
   - apps/api: NestJS 11, @nestjs/mongoose + Mongoose 8, @nestjs/config con validación zod del .env, nestjs-zod, @nestjs/swagger en /api/docs, helmet, cookie-parser, @nestjs/throttler, nestjs-pino. Prefijo global /api/v1. Filtro global de errores con respuesta { statusCode, code, message, details? } en español.
   - apps/web: React 19 + Vite + TS, React Router 7, TanStack Query 5, React Hook Form + zod, Tailwind CSS 4 + shadcn/ui, lucide-react, sonner, date-fns (locale es, zona America/Mexico_City). Cliente HTTP con interceptor que renueva el access token con /auth/refresh una sola vez ante un 401.
   - packages/shared: esquemas zod y tipos (User, Role, etc.), enums de la sección 4 del plan y reglas CASL (defineAbilityFor(user, grants)). Lo consumen api y web.
   - ESLint + Prettier compartidos, Vitest en shared y web, Jest + Supertest + mongodb-memory-server en api.
2. docker-compose.yml con mongo:7 como replica set de un nodo (rs0) e inicialización automática, más .env.example documentado.
3. Auth (sección 7 del plan): colecciones users, sessions, invitations. argon2id. Access JWT de 15 min en el body (el front lo guarda solo en memoria). Refresh de 30 días en cookie httpOnly/Secure/SameSite=Strict, hasheado en sessions y rotado en cada uso; si se detecta reuso, se revocan todas las sesiones del usuario. Endpoints: POST /auth/login, /auth/refresh, /auth/logout, /auth/logout-all, GET /auth/me, POST /auth/accept-invite (personal), POST /auth/forgot y /auth/reset (token de 1 hora; en local el correo se imprime en el log, en staging va por Resend). Throttle: 5 intentos por minuto por IP+email en login.
4. Autorización: guard global JwtAuthGuard con decorador @Public(), y PoliciesGuard con decorador @CheckPolicies((ability) => ...) que usa las reglas CASL de shared. Roles: ADMIN, DIRECTOR, TEACHER, GUARDIAN; un usuario puede tener varios.
5. Web: pantallas de login, olvidé contraseña, restablecer y aceptar invitación. Layout mobile-first: barra inferior de navegación en celular y barra lateral desde 1024 px. Rutas protegidas por rol: /admin, /director, /maestro, /padres, con un inicio vacío en cada una que diga "Próximamente". Si el usuario tiene varios roles, aparece un selector de rol en el menú. Todo el texto en español de México. Colores base: azul marino #1F3A7A (primario) y los colores por campo de la sección 5.
6. Script pnpm seed (idempotente) que crea la escuela "Esc. Prim. Fed. Dr. Salvador Allende T.M." (Colima, Col.), un admin, una directora y la maestra "Mtra. Viry", con contraseñas tomadas del .env.
7. CLAUDE.md en la raíz con: estructura del repo, comandos, convenciones (módulos Nest por dominio: controller + service + schema + dto zod; nada de lógica de negocio en controllers; toda consulta filtrada por schoolId y alcance; textos de UI en español; código y nombres en inglés; commits convencionales) y la regla de que las pruebas de permisos y del motor de cálculo nunca se borran ni se saltan.
8. GitHub Actions: lint, typecheck, test y build en cada PR. Dockerfile de api con Chromium instalado (lo usará Puppeteer en la etapa 4). Despliegue de staging: api en Railway (o Render) con MongoDB Atlas, web en Vercel. Documenta en docs/deploy.md las variables y los pasos manuales que yo deba hacer (crear cuentas, pegar secretos).
9. Pruebas: e2e de auth (login correcto e incorrecto, refresh con rotación, reuso de refresh revoca, logout, throttle) y prueba de que un TEACHER recibe 403 en una ruta de ADMIN.

Al terminar: corre pnpm lint, pnpm typecheck y pnpm test; todo debe pasar. Dame un resumen con lo hecho, cómo probarlo y lo que yo debo configurar a mano. Trabaja en la rama etapa-0-cimientos.
```

## Etapa 1 — Escuela, grupos, alumnos e importación (día 2, jueves 26 nov · sesión A)

Al terminar, el admin administra todo el catálogo desde la web, y el 5°B con sus 20 alumnos y las calificaciones del Periodo I ya está cargado desde el Excel actual.

**Entregables:** CRUD de escuela (con logo), ciclos, periodos, reglas de cálculo, grupos, alumnos, inscripciones con N/L, asignaciones de maestros, usuarios y permisos especiales. Además, el importador del Excel con vista previa y la pantalla del maestro con sus grupos.

**Criterios de aceptación**

- [ ] El admin crea ciclo 2026-2027, periodos 1-3, grupo 5°B y asigna a la maestra Viry como titular
- [ ] Al importar el Excel "Calificaciones y Boletas - Periodo I", la vista previa muestra 20 alumnos, 4 campos y las actividades con sus calificaciones, y señala las celdas dudosas antes de guardar
- [ ] Al confirmar, se crean alumnos, inscripciones, actividades y calificaciones del Periodo I sin duplicados; reimportar no duplica nada
- [ ] Un maestro solo ve sus grupos; un maestro de materia solo ve su materia
- [ ] El admin otorga a la directora `grade:update` en el 5°B por 2 días, y el permiso deja de aplicar al vencer
- [ ] Puede esperar: edición masiva de alumnos y CURP

```text
Lee docs/plan.md (secciones 2, 4 y 5) y CLAUDE.md. Hoy haces la ETAPA 1 — CATÁLOGOS E IMPORTACIÓN sobre lo que ya existe de la etapa 0. No toques auth salvo lo necesario.

1. Esquemas Mongoose + DTOs zod (en packages/shared) + módulos Nest para: schools (logo en GridFS, PUT/GET /school/logo, máximo 1 MB, png/jpg), schoolYears, periods (status OPEN, IN_REVIEW, CLOSED, PUBLISHED; por ahora solo crear y editar fechas), gradingSchemes (exactamente el JSON de la sección 5, validado con zod: cada conjunto de pesos suma 1, fieldWeight + subjectWeight = 1), groups, students, enrollments (listNumber único por grupo), teachingAssignments (HOMEROOM o SUBJECT con subjectKey) y permissionGrants (action, scope SCHOOL/GROUP, expiresAt opcional). Usa los índices de la sección 4. Todas las consultas se filtran por schoolId y por el alcance del usuario.
2. Amplía las reglas CASL de shared: ADMIN todo; DIRECTOR lectura en toda la escuela y escritura solo con un permissionGrant vigente; TEACHER lectura y escritura en grupos donde tiene teachingAssignment (si es SUBJECT, solo su subjectKey); GUARDIAN nada en estos módulos. Un helper scopeFilter(user, entity) devuelve el filtro Mongo que aplica cada service.
3. Usuarios (solo admin): listar, invitar personal con roles, cambiar roles, desactivar y forzar restablecer contraseña. Permisos especiales: listar, otorgar y revocar.
4. Importador de Excel con ExcelJS: POST /imports/excel/preview (multipart) y POST /imports/excel/commit (con el previewId). Debe leer el formato del Excel actual del 5°B:
   - Hoja "Lista": N/L en la columna A, nombre en la B, a partir de la fila 4.
   - Hojas "Lenguajes", "Saberes", "Ética" y "De lo humano": fila 3 = nombre de la actividad, fila 4 = fecha (texto libre), alumnos desde la fila 5. Columnas C-G = DESEMPENO, I-R = PROYECTO, T-U = EXAMEN, W = COMPLEMENTARIA (Inglés en Lenguajes, Ed. Física en De lo humano).
   - Hoja "Resumen": columna de Ajuste por campo (E, I, M, Q desde la fila 4).
   - Hoja "Observaciones": columna C desde la fila 4.
   Separa el nombre en apellido paterno, apellido materno y nombres (los dos primeros tokens son apellidos). Una celda vacía no crea registro; un 0 se guarda como NOT_DELIVERED. La vista previa lista advertencias: valores fuera de 0-10 (hay un 14 en Ética/Lotería), celdas vacías en actividades donde los demás alumnos sí tienen calificación, y nombres que ya existen. El commit corre en una transacción, es idempotente (clave: grupo + periodo + campo + componente + nombre de actividad) y guarda ajustes y observaciones en periodResults (sin calcular nada todavía). En apps/api/test/fixtures pon una copia anonimizada del Excel para las pruebas.
5. Web, admin (mobile-first, tablas que en celular se vuelven tarjetas): Escuela (datos + logo), Ciclos y periodos, Reglas de cálculo (formulario con los pesos), Grupos (crear, asignar maestros), Alumnos (lista con búsqueda, alta, inscripción con N/L), Usuarios, Permisos especiales e Importar Excel (subir, vista previa con advertencias en amarillo y rojo, confirmar).
6. Web, maestro: /maestro muestra tarjetas de sus grupos (nombre, ciclo, periodo actual y número de alumnos). Al abrir un grupo se ve la lista por N/L. Por ahora no hay captura.
7. Pruebas: CASL (maestro de otro grupo recibe 403; maestro de Inglés no ve Saberes; directora sin permiso recibe 403 al editar y con permiso vigente recibe 200; con permiso vencido recibe 403) e importador (20 alumnos, número de actividades por campo, el 14 sale como advertencia, reimportar no duplica).

Al terminar corre pnpm lint, typecheck y test. Resúmen: qué quedó, cómo probar la importación y qué advertencias salió con el Excel real. Rama etapa-1-catalogos.
```

## Etapa 2 — Captura diaria desde el celular (días 3-4, viernes 27 y lunes 30 nov · sesión A)

Al terminar, la maestra Viry crea una actividad y captura las 20 calificaciones de su hoja de papel en menos de 2 minutos desde el celular. También escribe notas del día por alumno.

**Entregables:** CRUD de actividades, captura por lotes con guardado automático, estados NE/NA, notas diarias, ficha del alumno, hoja de captura imprimible y bitácora de cambios en calificaciones.

**Criterios de aceptación**

- [ ] Crear una actividad toma 3 campos obligatorios (campo, componente, nombre) y la fecha de hoy viene llenada
- [ ] La captura de 20 alumnos se hace solo con el teclado numérico del celular, saltando de alumno en alumno
- [ ] Valores fuera de 0-10 o con más de un decimal se rechazan al escribir
- [ ] Al quitar la señal se puede seguir capturando y, al volver, todo se guarda sin perder datos
- [ ] Cada cambio de calificación queda en `auditLogs` con el valor anterior y el nuevo
- [ ] La hoja de captura en PDF imprime la lista por N/L con columnas vacías para anotar
- [ ] Puede esperar: duplicar una actividad a otro grupo, y adjuntar fotos

```text
Lee docs/plan.md (secciones 4, 6 y 7) y CLAUDE.md. Hoy haces la ETAPA 2 — CAPTURA DIARIA. La pantalla de captura es la más importante del sistema: optimízala para usarse con una mano en un celular de 360 px.

Backend:
1. activities: POST/PATCH/DELETE y GET /groups/:id/activities?periodId&fieldKey&component. Validaciones: el periodo debe estar OPEN; el componente COMPLEMENTARIA solo está permitido en campos con complementary en el gradingScheme y exige subjectKey; un maestro SUBJECT solo crea actividades de su subjectKey. visibleToGuardians es true por defecto y visibleFrom = createdAt + 24 h (configurable). Borrar una actividad con calificaciones exige confirmación (?force=true) y lo registra en la bitácora.
2. grades: GET /activities/:id/grades devuelve la lista del grupo por N/L con su calificación o null. PUT /activities/:id/grades recibe un lote [{ studentId, status, score?, comment? }] con upsert por activityId+studentId, en transacción. Validación zod: score de 0 a 10 con 1 decimal, obligatorio si status=SCORED; NOT_DELIVERED guarda score 0; EXCUSED guarda score null. El alumno debe estar inscrito y activo en el grupo. Responde con el lote guardado y updatedAt para control de concurrencia: si el cliente manda un updatedAt viejo de un registro que otro cambió, devuelve 409 con el valor actual.
3. studentNotes: CRUD; GET /groups/:id/notes?date y GET /students/:id/notes?periodId. El tipo SALUD nunca es visible a padres, aunque se intente marcar.
4. auditLogs: un interceptor o service que registra before/after en grades, activities y notes. Endpoint GET /audit?entity&entityId (admin y director; maestro solo en sus grupos).
5. GET /groups/:id/capture-sheet.pdf?activityId (o sin activityId para una hoja en blanco): tabla con N/L, nombre y una columna amplia para anotar, encabezado con el grupo, el campo, la actividad y la fecha. Usa Puppeteer con una plantilla HTML en apps/api/src/reports/templates.

Frontend (/maestro):
6. Pantalla Grupo → pestañas por campo formativo (con sus colores) → lista de actividades agrupada por componente, con fecha y "18/20 capturados". Botón flotante "+ Actividad".
7. Formulario Nueva actividad (bottom sheet en celular): campo (preseleccionado según la pestaña), componente (chips), nombre, fecha (hoy), medio opcional (Libreta, Hoja, Copia, Participación…) y descripción opcional. Al guardar, abre directo la captura.
8. Pantalla Capturar: encabezado fijo con actividad, contador y estado "Guardando… / Guardado"; filas por N/L con nombre corto (primer nombre + primer apellido), input grande con inputMode="decimal" y enterKeyHint="next" que al dar Enter enfoca el siguiente; botones NE, NA y 10 por fila. Guardado automático con debounce de 2 s y al salir del input, mandando solo lo que cambió. Cola offline: si falla la red, guarda en IndexedDB (idb-keyval) y reintenta con backoff; muestra un aviso "Sin conexión: X cambios por enviar". Al salir con cambios pendientes, pide confirmación.
9. Notas: desde la lista del grupo, al tocar un alumno se abre su ficha (calificaciones del periodo por campo y notas). Botón "+ Nota" con tipo, campo opcional, texto y casilla "Visible para padres". También hay una vista "Notas de hoy" del grupo.
10. Botón "Hoja de captura" en cada actividad, que descarga el PDF.
11. Accesibilidad: objetivos táctiles de al menos 44 px, contraste AA y textos en español.

Pruebas:
- api: lote válido; 14 rechazado; alumno de otro grupo rechazado; periodo CLOSED rechazado; 409 por concurrencia; auditLog creado; nota SALUD nunca visible a padres.
- Playwright en viewport de iPhone 12: crear una actividad, capturar 20 calificaciones con teclado y Enter, recargar y verificar que se guardó; simular offline, capturar 3, volver online y verificar.

Al terminar corre lint, typecheck y test. Rama etapa-2-captura.
```

## Etapa 3 — Motor de cálculo, resumen en vivo y alertas (días 2-4, jueves 26 a lunes 30 nov · sesión B)

Al terminar, el maestro ve en todo momento el promedio de cada alumno en cada campo, igual al que daría el Excel, y quién va bajo. El motor arranca en paralelo desde el día 2 porque es código puro en `shared`; el resumen se conecta cuando la etapa 2 tiene datos.

**Entregables:** paquete `grading` en shared con pruebas doradas de las 80 calificaciones del Periodo I, endpoint de resumen de grupo y de alumno, pantalla Resumen del grupo con alertas y mini tablero de la escuela para el director.

**Criterios de aceptación**

- [ ] Las 80 calificaciones calculadas del Periodo I del 5°B coinciden con el Excel a 4 decimales, y las redondeadas coinciden exactas
- [ ] Los casos borde están probados: componente sin actividades, todo EXCUSED, NOT\_DELIVERED como 0, punto flotante (x.4999999)
- [ ] El resumen de un grupo de 20 alumnos con 60 actividades responde en menos de 300 ms
- [ ] La pantalla Resumen marca en rojo los campos menores a 6, en ámbar los menores a 7, y lista pendientes por actividad
- [ ] Puede esperar: alertas por tendencia ("bajó 1.5 puntos en 2 semanas")

```text
Lee docs/plan.md (sección 5 completa) y CLAUDE.md. Haces la ETAPA 3 — MOTOR DE CÁLCULO Y RESUMEN EN VIVO. Empieza por el motor (no depende de nada) y conecta los endpoints cuando existan activities y grades.

1. packages/shared/src/grading: funciones puras, sin dependencias de Nest ni Mongo:
   - componentAverage(grades): promedio de SCORED + NOT_DELIVERED (como 0); ignora EXCUSED y pendientes; devuelve { value | null, counted, pending }.
   - fieldScore(fieldConfig, componentAverages, complementary?): aplica los pesos y, si el campo tiene complementary, la mezcla 0.7/0.3. Si falta un componente, devuelve { value: parcial con los pesos repartidos entre lo que sí hay, partial: true, missing: [...] }.
   - roundHalfUp(x, preDecimals = 4): primero redondea a 4 decimales y después al entero con .5 hacia arriba. Usa aritmética entera escalada, nunca Math.round directo sobre el float.
   - studentPeriodResult(scheme, activities, grades, overrides): por cada campo devuelve calculated, rounded, override, final y adjusted (bool), más generalAverage (1 decimal), lowFields (campos con calculated < lowThreshold) y legendSuggested ("Ojo en: Saberes, Ética.").
   - Tipos exportados para api y web.
2. Pruebas doradas con Vitest: en packages/shared/test/fixtures/periodo1-5B.json pon, para los 20 alumnos, las calificaciones por actividad de los 4 campos y los resultados esperados (calculada y redondeada) que da el Excel. Sale del Excel de la etapa 1: hoja Resumen, columnas C/G/K/O = calculada y D/H/L/P = redondeo. Escribe un script scripts/build-golden-fixture.ts que lo genere con ExcelJS desde apps/api/test/fixtures. Verifica estos valores a mano: Aguilar Lenguajes 9.0375 → 9; Aguilar De lo humano 9.0725 → 9; Álvarez Saberes ≈ 5.93 → 6; Álvarez Ética ≈ 4.42 → 4; Monroy Ética ≈ 9.34 → 9. Las 80 deben coincidir: calculada con toBeCloseTo(x, 4) y redondeada exacta. Agrega casos borde: componente vacío, todo EXCUSED, 9.4999999 → 10, 8.45 → 8, override fuera de 5-10 rechazado.
3. API: GET /groups/:id/summary?periodId devuelve, por alumno: componentes por campo, calculated, rounded, partial, pendientes y lowFields; por grupo: promedio por campo, distribución y lista de alertas [{ studentId, fieldKey, type: LOW_6 | LOW_7 | PENDING | PARTIAL }]. GET /students/:id/summary?periodId devuelve lo mismo para un alumno, con el detalle por actividad. Haz el cálculo en memoria con 2 consultas (activities y grades del grupo y periodo) y el motor de shared; nada de aggregation pipelines que dupliquen la lógica. Caché de 30 s por grupo y periodo, invalidada al guardar grades.
4. Web /maestro/grupos/:id/resumen: en celular, una tarjeta por alumno con 4 chips de color (uno por campo) con el promedio (rojo < 6, ámbar < 7) y la etiqueta "parcial" si aplica; en tablet y computadora, una tabla alumnos × campos con D, P, E y final desplegables. Arriba, la sección "Atención": alumnos con alertas y actividades con pendientes (toca y abre la captura). La ficha del alumno (etapa 2) muestra ahora su resumen con una barra por campo.
5. Web /director: tablero con los grupos de la escuela (avance de captura: actividades y % capturado; promedio por campo; número de alumnos con alertas). Al tocar un grupo abre el mismo resumen en solo lectura.
6. Pruebas api: el resumen respeta el alcance (maestro de otro grupo recibe 403, director 200) y la caché se invalida al guardar.

Al terminar corre lint, typecheck y test; las 80 pruebas doradas deben pasar. Rama etapa-3-motor.
```

## Etapa 4 — Cierre de periodo y boletas (días 5-6, martes 1 y miércoles 2 dic · sesión A)

Al terminar, la maestra revisa ajustes y observaciones en una sola pantalla y descarga las 20 boletas del grupo en PDF o Word. Las boletas tienen el mismo diseño que ya aprobó: logos, colores por campo, `*` en ajustes, "Ojo en", compromisos y firma centrada.

**Entregables:** flujo de periodo (OPEN → IN\_REVIEW → CLOSED → PUBLISHED), pantalla de cierre por grupo, observaciones por campo, boletas PDF (Puppeteer) y Word (docx), y boleta individual.

**Criterios de aceptación**

- [ ] La pantalla de cierre muestra por alumno calculada, redondeo, ajuste y final de los 4 campos, y permite ajustar con motivo
- [ ] No se puede cerrar con pendientes o campos parciales; el sistema dice cuáles faltan
- [ ] Al cerrar se guarda la foto en `periodResults`; editar una actividad después no cambia la boleta
- [ ] El PDF del grupo sale en tamaño carta, una boleta por hoja, en menos de 15 s para 20 alumnos; el Word abre bien en Word y en Google Docs
- [ ] La boleta del Periodo I generada desde el sistema coincide con la del Word que se entregó el 18 de noviembre
- [ ] Solo el admin reabre, con motivo, y queda en la bitácora

```text
Lee docs/plan.md (secciones 2, 4, 5 y 6) y CLAUDE.md. Haces la ETAPA 4 — CIERRE DE PERIODO Y BOLETAS. Usa el motor de packages/shared/grading; no dupliques fórmulas.

1. Estados del periodo por grupo. Guarda en periodResults el estado del grupo, o crea una colección periodGroupStatus { periodId, groupId, status, closedAt, closedBy, publishedAt, reopenedAt, reopenReason }. Flujo: OPEN → IN_REVIEW (el maestro titular lo pide) → CLOSED (el admin, o el maestro si el admin habilitó "cierre por maestro" en la escuela) → PUBLISHED (el admin o el director con permiso; desde aquí lo ven los padres). POST /periods/:id/groups/:groupId/{review|close|publish|reopen}; reopen solo admin, con reason obligatorio. En IN_REVIEW se pueden editar ajustes y observaciones pero no actividades. En CLOSED y PUBLISHED no se edita nada.
2. GET /groups/:id/period-results?periodId: si está OPEN o IN_REVIEW calcula en vivo y combina con los overrides y observaciones guardados; si está CLOSED devuelve la foto. PATCH /period-results/:id acepta { fields: [{ fieldKey, override?, overrideReason? }], observations: { general?, byField: { lenguajes?, saberes?, etica?, humano? } }, legendOverride? }. Validación: override entero de 5 a 10. Todo cambio va a auditLogs.
3. Cerrar = transacción: valida que no haya pendientes ni parciales (si los hay, 422 con la lista { studentId, fieldKey, activityIds }), calcula con el motor y guarda la foto completa (componentes, calculated, rounded, override, final, generalAverage, legendSuggested, observaciones) con snapshotAt.
4. Boletas:
   - Plantilla HTML única en apps/api/src/reports/templates/report-card.html (Handlebars), tamaño carta, márgenes de 0.5 in.
   - Encabezado de unos 4 cm: logo de la escuela a la izquierda, logo del maestro titular a la derecha (subido en su perfil), y al centro el nombre de la escuela en mayúsculas azul marino #1F3A7A, "Resultados individuales · Evaluación formativa", periodo + ciclo, grupo + docente y lugar + fecha de entrega (periods.deliveryDateText).
   - Franja del alumno con nombre y N/L.
   - Tabla con encabezado azul marino y columnas: Campo formativo (con su color), Desempeño (50%), Proyectos (20%), Exámenes (30%), Promedio del campo, Inglés / Ed. Física (— si no aplica), Promedio final y Calificación (grande, con * si hubo ajuste). Debajo, la nota "* Calificación ajustada por la maestra." y el promedio general resaltado.
   - Recuadro de Observaciones con borde completo y los párrafos "Lenguajes: …" y "Saberes y pensamiento científico: …" con la etiqueta en negritas, y la observación general si existe.
   - Leyenda "Ojo en" en rojo; recuadro de Compromisos de padres con 4 líneas; firma centrada "Nombre y firma de padre, madre o tutor".
   - Una boleta por página (page-break-after).
   - PDF con Puppeteer (una sola instancia de navegador reutilizada, cola de 2 trabajos a la vez). GET /groups/:id/report-cards.pdf?periodId (todo el grupo) y GET /students/:id/report-card.pdf?periodId.
   - Word con la librería docx, con el mismo contenido y diseño equivalente (tablas con anchos en DXA, sombreado CLEAR, logos como ImageRun, salto de página por alumno). GET /groups/:id/report-cards.docx?periodId.
   - Nombre de archivo: "Boletas 5°B - Periodo I.pdf".
5. Web /maestro/grupos/:id/cierre: lista de alumnos. Cada tarjeta muestra los 4 campos (calculada → final) con un control para ajustar y motivo opcional, dos áreas de texto (Lenguajes y Saberes) más observación general, y la leyenda sugerida con opción de reemplazarla. Botón "Vista previa" (la boleta en HTML dentro de un modal) y botones "Descargar PDF" y "Descargar Word" del grupo. Indicador de avance: "14 de 20 con observaciones". Las notas del periodo del alumno aparecen al lado como referencia para redactar.
6. Web /admin/periodos: estado de cada grupo por periodo, con botones de cerrar, publicar y reabrir (con motivo).
7. Pruebas: cerrar con pendientes da 422; después de cerrar, editar una actividad da 409/422 y la foto no cambia; override 11 rechazado; reabrir sin motivo rechazado; el PDF del fixture del Periodo I tiene 20 páginas; el docx abre con mammoth sin errores. Prueba visual: guarda un PNG de la primera página en apps/api/test/__snapshots__ para revisión manual.

Al terminar corre lint, typecheck y test. Rama etapa-4-cierre-boletas.
```

## Etapa 5 — Portal del director y portal de padres (días 5-7, martes 1 a jueves 3 dic · sesión B)

Al terminar, la directora consulta cualquier grupo, alumno y boleta sin poder modificar nada (salvo permiso del admin). Cada padre entra con su código, ve a todos sus hijos y consulta calificaciones, notas y boletas publicadas.

**Entregables:** vistas de solo lectura del director con bitácora, invitaciones de padres con código, portal de padres con varios hijos, aviso de privacidad y descarga de boletas publicadas.

**Criterios de aceptación**

- [ ] La directora navega escuela → grupo → alumno → actividad y no ve ningún botón de edición; la API responde 403 si lo intenta
- [ ] Con un permiso especial vigente, la directora ve los botones de edición solo en el alcance otorgado
- [ ] El maestro genera un código por alumno, que se puede imprimir en tira para recortar o compartir por WhatsApp
- [ ] Un padre con 2 hijos en distintos grupos ve ambos y cambia entre ellos
- [ ] Un padre no ve actividades antes de `visibleFrom`, ni notas no visibles, ni notas SALUD, ni boletas no publicadas
- [ ] Pruebas de aislamiento: un padre que pide el id de otro alumno recibe 404
- [ ] Puede esperar: avisos por correo cuando se publica una boleta

```text
Lee docs/plan.md (secciones 2, 6 y 7) y CLAUDE.md. Haces la ETAPA 5 — PORTALES DEL DIRECTOR Y DE PADRES. Depende de las etapas 1-3; la parte de boletas publicadas usa los endpoints de la etapa 4 (si aún no están, deja el botón detrás de un flag y conéctalo al final).

Director:
1. /director: tablero de la etapa 3 más navegación de solo lectura a Grupos → Grupo (actividades por campo, resumen, notas) → Alumno (ficha completa) → Boletas (vista previa y descarga si el periodo está CLOSED o PUBLISHED). Reutiliza los componentes del maestro con una prop readOnly derivada de la ability CASL (no de roles fijos), para que un permissionGrant vigente active la edición solo donde aplica.
2. /director/bitacora: lista filtrable de auditLogs (fecha, usuario, grupo, entidad) con before → after legible ("Calificación de Ana en 'Proyecto Repaso': 6 → 8").

Invitaciones de padres:
3. POST /invitations/guardian { studentId, relationship? } (maestro titular del grupo o admin) genera un código de 8 caracteres sin ambiguos (sin 0/O/1/I), guarda solo el hash y vence en 14 días. Un alumno puede tener hasta 4 tutores. GET /groups/:id/guardian-invitations lista el estado por alumno (sin código, vinculado, pendiente).
4. En la web del maestro, pantalla "Padres de familia" del grupo: por alumno, el botón "Generar código", con opción de imprimir todos los códigos en tiras recortables (PDF: nombre del alumno, código, URL y pasos en 3 líneas) o compartir uno por WhatsApp (enlace wa.me con texto prellenado; no se guarda el teléfono).
5. Alta del padre: /registro?codigo=XXXX → muestra "Vas a vincularte con: Aguilar C. Edgar M., 5°B" (nombre parcialmente oculto) → si ya tiene cuenta, inicia sesión; si no, crea cuenta con nombre, correo, contraseña y parentesco → acepta el aviso de privacidad (versión y fecha guardadas en el usuario) → queda el guardianLink. Un padre existente puede canjear más códigos desde "Agregar hijo".

Portal de padres (/padres), mobile-first y con lenguaje sencillo:
6. Inicio: tarjetas por hijo (nombre, grupo, maestra, foto opcional en el futuro). Si solo hay uno, entra directo.
7. Hijo → pestañas:
   - Avance: por campo, el promedio actual con una barra de 0 a 10 y la etiqueta "en curso"; si está por debajo de 7, un mensaje amable "Necesita apoyo en …". Recharts con la evolución semanal por campo.
   - Actividades: lista cronológica con campo, nombre, fecha y calificación (NE = "No entregado").
   - Notas de la maestra: solo las visibles.
   - Boletas: periodos PUBLISHED con su calificación final por campo y el botón "Descargar boleta (PDF)".
8. Endpoints GET /me/children, /me/children/:id/overview?periodId, /me/children/:id/activities?periodId, /me/children/:id/notes?periodId y /me/children/:id/report-card.pdf?periodId. Verifican el guardianLink activo y devuelven 404 (no 403) si no existe, para no revelar que el alumno existe. Filtran visibleToGuardians, visibleFrom <= ahora y kind != SALUD; boletas solo PUBLISHED. Nunca devuelven datos de otros alumnos ni promedios del grupo.
9. Admin: en la ficha del alumno, ver y desvincular tutores.
10. Aviso de privacidad: página /privacidad con texto de plantilla marcado "PENDIENTE DE REVISIÓN POR LA DIRECCIÓN", editable por el admin desde /admin/escuela.

Pruebas: aislamiento (padre A no accede al alumno de padre B: 404 en todos los endpoints /me/children); filtros de visibilidad; código vencido o usado rechazado; director sin permiso recibe 403 en PUT grades y con permiso vigente recibe 200. Playwright en viewport de celular: un padre canjea el código, ve a su hijo y descarga la boleta publicada.

Al terminar corre lint, typecheck y test. Rama etapa-5-portales.
```

## Etapa 6 — Historial, endurecimiento y producción (días 7-8, jueves 3 y viernes 4 dic · sesiones A y B)

Al terminar, el sistema está en producción con dominio propio, respaldos y monitoreo. El 5°B tiene su Periodo I importado y cerrado, y el Periodo II abierto para capturar desde el lunes 7.

**Entregables:** comparativo entre periodos, exportaciones a Excel, PWA instalable, revisión de seguridad y rendimiento, producción, manual corto por rol y carga de datos reales.

**Criterios de aceptación**

- [ ] La ficha del alumno y el portal de padres muestran Periodo I vs II por campo (con datos de prueba en el II)
- [ ] El admin y el maestro exportan el concentrado del periodo a Excel (formato parecido a la hoja Resumen actual)
- [ ] Lighthouse en celular: rendimiento de 85 o más y accesibilidad de 95 o más en las pantallas de captura y del portal de padres
- [ ] Todas las pruebas de permisos y aislamiento pasan en producción con usuarios de prueba (que después se borran)
- [ ] Respaldo diario de Atlas activo y restauración probada una vez en staging
- [ ] Manual de una página por rol entregado
- [ ] Puede esperar: gráficas comparativas del grupo completo para el director

```text
Lee docs/plan.md completo y CLAUDE.md. Haces la ETAPA 6 — HISTORIAL, ENDURECIMIENTO Y PRODUCCIÓN. Prioridad: lo que asegura que el sistema sea confiable el lunes; lo comparativo va después.

1. Endurecimiento (primero):
   - Revisa cada controller: todos usan @CheckPolicies o @Public explícito. Agrega una prueba que recorra el router de Nest y falle si hay una ruta sin política.
   - Pruebas de aislamiento completas por rol (matriz de la sección 2) con un seed de 2 grupos, 2 maestros y 2 padres.
   - helmet con CSP estricta para la web, CORS solo al dominio de producción, cookies Secure, robots noindex, cabecera X-Robots-Tag.
   - Logs sin datos personales (redacta nombres, correos y textos de notas en pino). Sentry en api y web con sendDefaultPii: false.
   - Índices verificados con explain() en: summary del grupo, grades por actividad y /me/children.
2. Producción: dominio (el que yo indique) con HTTPS; Atlas M10 con respaldo diario y retención de 7 días; api en Railway/Render con 2 instancias y healthcheck /api/v1/health (Mongo + Puppeteer listo); web en Vercel. Variables documentadas en docs/deploy.md. Script pnpm migrate:prod que crea índices y el gradingScheme 2026-2027. Checklist de salida en docs/go-live.md.
3. Historial: GET /students/:id/history?schoolYearId devuelve los periodos con sus finales por campo (de la foto si está cerrado; en vivo si está abierto). En la web: en la ficha del alumno (maestro y director) y en el portal de padres, una gráfica de barras agrupadas por campo × periodo (Recharts) y una tabla compacta.
4. Exportaciones: GET /groups/:id/period-results.xlsx?periodId con ExcelJS, con una hoja Resumen (N/L, alumno; por campo: calculada, redondeo, ajuste y boleta; promedio general; Ojo en) y una hoja por campo con las actividades. Botón en el cierre del maestro y en el admin.
5. PWA con vite-plugin-pwa: manifest (nombre "Evaluación Allende", íconos a partir del logo de la escuela, color #1F3A7A), precache del shell y botón "Instalar en tu celular" en el perfil. Las respuestas de la API no se cachean salvo la cola offline de la etapa 2.
6. Rendimiento: lazy loading por rol (cada portal en su chunk), imágenes de logos optimizadas y Lighthouse móvil con las metas de los criterios.
7. Manuales: docs/manual-maestro.md, manual-director.md, manual-padres.md y manual-admin.md, de una página cada uno, con pasos numerados y lenguaje sencillo. Genera también un PDF de cada uno.
8. Carga real: con el importador, carga el Excel del Periodo I del 5°B en producción, cierra el Periodo I (la foto debe coincidir con las boletas entregadas), abre el Periodo II y crea las cuentas de la maestra Viry y la directora con invitación.

Al terminar corre lint, typecheck, test y la suite e2e contra staging. Entrégame el checklist de go-live marcado y lo que quede pendiente. Rama etapa-6-produccion.
```

## 9. Transición, pruebas y riesgos

**Transición del papel al sistema (6 meses como mínimo).** El papel sigue siendo el respaldo, y el sistema se gana la confianza con datos:

1. **Diciembre a enero:** el maestro anota en papel (con la hoja de captura que imprime el sistema) y vacía el mismo día o al siguiente. Al cierre del Periodo II también se exporta el concentrado a Excel para compararlo con el cálculo manual de un grupo.
2. **Febrero a mayo:** cada maestro decide si sigue con papel. La bitácora y la exportación semanal a Excel sirven de respaldo.
3. **Indicador de confianza:** cero diferencias entre el concentrado del sistema y el cálculo manual en 2 cierres seguidos.

**Estrategia de pruebas**

| Tipo | Qué cubre | Dónde |
| --- | --- | --- |
| Doradas | Las 80 calificaciones del Periodo I contra el Excel | `packages/shared` (Vitest) |
| Unitarias | Motor (casos borde), validaciones zod, reglas CASL | shared, api |
| Integración | Endpoints con Mongo en memoria, transacciones, bitácora | api (Jest + Supertest) |
| Aislamiento | Matriz de permisos completa; padres y maestros fuera de su alcance | api, en cada PR |
| E2E | Login, captura en celular, cierre y boleta, alta de padre | Playwright (iPhone 12 y escritorio) |
| Visual | Primera página de la boleta PDF | snapshot PNG revisado a mano |

**Riesgos**

| Riesgo | Efecto | Qué hacemos |
| --- | --- | --- |
| Calendario de 8 días muy ajustado | Llegar al viernes sin portales | Dos sesiones en paralelo; recortes ya definidos en la sección 8 |
| Diferencias de redondeo con el Excel | Boletas distintas a las entregadas | Pruebas doradas obligatorias antes de cualquier pantalla |
| Puppeteer pesado en el servidor | PDFs lentos o la API se cae | Una instancia reutilizada, cola de 2 trabajos, mínimo 1 GB de RAM |
| Mala señal en el salón | Capturas perdidas | Cola offline en el celular y aviso visible de cambios por enviar |
| Un padre vinculado al alumno equivocado | Exposición de datos de un menor | Código por alumno, confirmación del nombre y desvinculación por el admin |
| Datos de menores sin aviso de privacidad aprobado | Riesgo legal | No se invita a padres hasta que la dirección apruebe el aviso |

**Decisiones pendientes** (las necesitamos antes del día indicado)

- [ ] Dominio del sistema (por ejemplo `evaluacion.escuelaallende.mx`) — antes del día 7
- [ ] Quién paga y administra Atlas, Railway/Render y Vercel (cerca de 60 a 80 USD al mes en producción pequeña) — antes del día 1
- [ ] Si el maestro puede cerrar su propio periodo o solo el admin — antes del día 5
- [ ] Si las calificaciones de cada actividad se muestran a los padres o solo los promedios — antes del día 5
- [ ] Revisión y aprobación del aviso de privacidad por la dirección — antes de invitar padres
- [ ] Nombre completo de la maestra Viry para la boleta, y lista de los demás maestros y grupos que entran en enero
