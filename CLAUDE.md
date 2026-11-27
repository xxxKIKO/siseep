# CLAUDE.md

Sistema web de evaluación escolar para la Esc. Prim. Fed. Dr. Salvador Allende T.M. (Colima, Col.).
**La especificación es [docs/plan.md](docs/plan.md)**: léela antes de cada etapa y no implementes
nada de etapas posteriores a la que se pide.

## Estructura del repo

```text
apps/
  api/                 NestJS 11 + Mongoose 8. Un módulo por dominio en src/<dominio>/
    src/auth/          login, refresh con rotación, guards globales (JwtAuthGuard, PoliciesGuard)
    src/access/        AbilityFactory: roles + permisos especiales + asignaciones → ability CASL
    src/common/        errores, decoradores (@Public, @CheckPolicies, @CurrentActor), scope.ts
    src/config/        validación zod del .env (env.ts)
    src/database/      ModelsModule: registra todos los modelos una vez (global)
    src/<dominio>/     schools, school-years (+ periods, grading scheme), groups, students,
                       activities (+ grades), notes, audit, reports (PDF/Word), permission-grants,
                       users (admin, /me), imports (Excel), summary, closing (cierre y resultados)
    src/periods/       PeriodStatusService: estado del periodo POR GRUPO (periodGroupStatuses)
    src/files/         FilesService: logos en GridFS (escuela y maestro titular)
    src/guardians/     códigos para padres, guardianLinks y portal /me/children (404 si no es tu hijo)
    src/reports/templates/  plantillas HTML de los PDF (Puppeteer; boleta con Handlebars)
    test/__snapshots__/     PNG de la primera boleta para revisión manual (lo genera la e2e)
    src/scripts/       seed.ts y migrate.ts (`pnpm migrate:prod`: índices + ciclo 2026-2027)
    scripts/           anonymize-workbook.mjs (genera el fixture anonimizado del Excel)
    test/              e2e con Jest + Supertest + mongodb-memory-server (replica set)
    test/fixtures/     Excel del 5°B anonimizado (nombres y observaciones ficticios)
    Dockerfile         imagen de producción (incluye Chromium para Puppeteer)
  web/                 React 19 + Vite + Tailwind 4 + shadcn/ui
    src/auth/          AuthProvider, guards de rutas por rol, selector de rol
    src/lib/           api-client (interceptor de refresh), fechas (es, America/Mexico_City)
    src/components/ui/ componentes estilo shadcn (se copian, no se instalan)
    src/pages/         pantallas; rutas en src/routes.tsx
    src/pages/teacher/capture/  pantalla Capturar (useCapture: guardado, cola offline, conflictos)
    src/pages/guardian/  portal de padres; src/pages/public/: /registro y /privacidad
    src/auth/ability.ts  useCan (reglas CASL de GET /auth/abilities) y usePortalBase
    src/portals/       un chunk por portal (carga diferida desde routes.tsx)
    e2e/               Playwright (iPhone 12): Mongo en memoria + API compilada + vite preview
packages/
  shared/              esquemas zod, tipos, enums (sección 4), colores, reglas CASL (defineAbilityFor)
    src/grading/       MOTOR DE CÁLCULO (sección 5): funciones puras, sin Nest ni Mongo
    test/fixtures/periodo1-5B.json  datos dorados del Excel (generado, no editar a mano)
  eslint-config/       ESLint compartido (base y react)
  tsconfig/            tsconfig base, nest, react y library
scripts/dev.mjs        orquesta `pnpm dev` (Mongo + seed + api + web)
scripts/build-icons.mjs  íconos de la PWA desde el logo (`pnpm icons:build <logo>`)
scripts/build-manuals.mjs  PDF de los manuales (`pnpm manuals:pdf`, una página cada uno)
docs/                  plan.md (especificación), deploy.md, go-live.md y manual-*.md (+ pdf/)
```

## Comandos

| Comando                                                     | Qué hace                                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm i`                                                    | Instala todo (descarga mongod 7 para pruebas la primera vez)                                             |
| `pnpm dev`                                                  | Crea `.env` si falta, revisa Mongo y puertos, corre el seed si la base está vacía, api :3000 y web :5173 |
| `pnpm dev:db`                                               | Solo revisa (o levanta, con `DEV_START_MONGO=true`) la base de datos                                     |
| `pnpm seed`                                                 | Seed idempotente (escuela, admin, directora, Mtra. Viry) con datos del `.env`                            |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | Lo mismo que corre la CI                                                                                 |
| `pnpm format`                                               | Prettier en todo el repo                                                                                 |
| `pnpm --filter @siseep/api test`                            | Solo pruebas de la API                                                                                   |
| `pnpm golden:build`                                         | Regenera las pruebas doradas del motor desde el fixture del Excel (`scripts/build-golden-fixture.ts`)    |
| `pnpm test:e2e`                                             | Playwright en viewport de iPhone 12 (compila shared y api; usa tu Chrome local, en CI Chromium)          |
| `LIGHTHOUSE=1 pnpm test:e2e`                                | Además mide Lighthouse móvil en captura y portal de padres (reportes en `apps/web/test-results`)         |
| `pnpm migrate:prod`                                         | Índices + escuela + ciclo 2026-2027 con sus reglas (idempotente; Railway la corre en cada despliegue)    |

- **Mongo local**: se usa el MongoDB que ya corre en `127.0.0.1:27017` (replica set `rs0`,
  necesario para las transacciones), compartido con otros proyectos; SISEEP solo usa la base
  `siseep`. Las pruebas no dependen de él: usan su propio replica set en memoria. Con
  `DEV_START_MONGO=true`, `pnpm dev` levanta un Mongo propio (Docker en 27018 o `.data/mongo`).
- **Fixture del Excel**: si cambia el formato del Excel real, regenera el fixture con
  `node apps/api/scripts/anonymize-workbook.mjs "<Excel real>" apps/api/test/fixtures/calificaciones-5B-periodo1.xlsx`.
  El script falla si queda algún nombre real. El Excel original nunca se sube al repo.
- **Varios proyectos a la vez**: los puertos se cambian en `.env` (`PORT` = API, `WEB_PORT` =
  web; si cambias `WEB_PORT`, ajusta `WEB_ORIGIN` y `WEB_URL`). `pnpm dev` avisa si un puerto
  está ocupado.
- Swagger: http://localhost:3000/api/docs. En local los correos se imprimen en el log de la API.
- En Windows, corre Vitest desde una ruta con la unidad en mayúscula (`D:\`). Si la terminal
  queda en `d:\`, React se carga dos veces y aparece "Invalid hook call".

## Convenciones

- **Módulos Nest por dominio**: `controller` + `service` + `schema` (Mongoose) + `dto` (zod con
  `createZodDto`, esquema definido en `packages/shared`). Nada de lógica de negocio en los
  controllers: solo reciben, llaman al service y responden.
- **Autorización**: todas las rutas pasan por `JwtAuthGuard` (global); las públicas llevan
  `@Public()`. Cada ruta protegida declara `@CheckPolicies((ability) => ...)` con las reglas CASL
  de `packages/shared/src/abilities.ts`, o `@Authenticated()` si es de la propia cuenta (perfil,
  sesión, logo). `test/route-policies.e2e-spec.ts` falla si una ruta no declara ninguna de las
  tres. El frontend solo oculta botones; el backend decide.
- **Alcance de datos**: toda consulta se filtra por `schoolId` y por el alcance del usuario
  (grupos asignados, alumnos vinculados). Nunca confíes en ids del frontend sin revisar el alcance.
  En los services: recibe `Actor` (`@CurrentActor()`), lista con `scopedQuery(actor, 'Group')`
  (filtro Mongo generado de las mismas reglas CASL con `scopeFilter`) y, al cargar un registro,
  `assertCan(actor.ability, 'update', 'Activity', doc)`. Las condiciones CASL usan ids como
  string (`_id`, `schoolId`, `groupId`, `subjectKey`).
- **Bitácora**: todo cambio de calificaciones, actividades y notas se registra con
  `AuditService.record(actor, entries, session)` **dentro de la misma transacción** que el cambio
  (antes/después). No uses interceptores para esto.
- **Calificaciones**: el lote `PUT /activities/:id/grades` es transaccional y acepta
  `expectedUpdatedAt` por alumno (control de concurrencia: 409 `GRADE_CONFLICT` con el valor
  actual). La web resuelve conflictos con "gana el servidor" y avisa.
- **Notas de salud**: nunca visibles para padres. Usa `normalizeNoteVisibility` al guardar e
  `isNoteVisibleToGuardians` en cualquier lectura para padres (ambas en `packages/shared`).
- **Motor de cálculo**: toda calificación de campo, redondeo, promedio general y "Ojo en" sale de
  `packages/shared/src/grading` (`studentPeriodResult`). La API y la web nunca reimplementan
  fórmulas ni usan aggregation pipelines para calcular. El redondeo usa `roundHalfUp`/`roundTo`
  (aritmética decimal entera), nunca `Math.round` sobre el número de punto flotante.
- **Resumen en vivo**: `SummaryService` con caché de 30 s por grupo y periodo (`SummaryCache`). Todo
  lo que cambie promedios (calificaciones, actividades, importación) debe llamar
  `summaryCache.invalidateGroup(groupId)`.
- **PDF**: `PdfService` (puppeteer-core, una instancia, cola `PDF_CONCURRENCY`); plantillas en
  `src/reports/templates/*.html` con `{{clave}}` escapado por `renderTemplate`. La boleta
  (`report-card.html`) usa Handlebars; el Word sale de los mismos datos con `docx`
  (`report-card.docx.ts`). Antes de cerrar, la boleta lleva marca de agua "BORRADOR".
- **Estado del periodo por grupo**: OPEN → IN_REVIEW → CLOSED → PUBLISHED (reabrir: solo admin,
  con motivo). Nunca leas `period.status` para decidir si algo se puede editar: usa
  `PeriodStatusService` (`assertOpen` para actividades, calificaciones e importación;
  `assertResultsEditable` para ajustes, observaciones y notas; `effective` para mostrarlo).
- **Cierre**: `PeriodResultsService` usa el mismo `PeriodDataService` que el resumen. Cerrar es
  una transacción: si hay pendientes o campos parciales responde 422 `PERIOD_INCOMPLETE` con
  `{studentId, fieldKey, activityIds}`; si no, guarda la foto completa en `periodResults`
  (`snapshotAt`). Con el periodo cerrado, resultados y boletas salen de la foto, no del cálculo.
- **Director y botones de edición**: las pantallas del maestro se reutilizan en `/director/...`.
  Qué se puede editar sale de `useCan()` (reglas CASL del usuario, incluidos permisos especiales
  vigentes), nunca de roles fijos. Los enlaces usan `usePortalBase()`.
- **Portal de padres**: todo pasa por `GuardianPortalService`, que exige un `guardianLink` ACTIVE
  y responde 404 (no 403) si no existe. Solo actividades con `visibleToGuardians` y
  `visibleFrom <= ahora`, notas visibles y nunca `SALUD`, boletas solo con el periodo PUBLISHED.
  Nunca devuelve otros alumnos ni promedios del grupo. Los códigos (8 caracteres sin 0/O/1/I,
  14 días, un uso, máximo 4 tutores) se guardan solo como hash.
- **Bitácora legible**: `AuditDescriber` arma la descripción ("Calificación de Ana en 'X': 6 → 8");
  si agregas una entidad a `AUDIT_ENTITIES`, agrega su caso ahí.
- **Denormalización para el alcance**: `grades` copia `groupId`, `periodId`, `fieldKey`,
  `component` y `subjectKey` de su actividad para filtrar por grupo y materia sin joins.
- **Errores**: lanza `AppException` / `Errors.*` (`src/common/app.exception.ts`). La API responde
  siempre `{ statusCode, code, message, details? }` con `message` en español.
- **Idioma**: textos de UI y mensajes de error en español de México; código, nombres de
  variables, colecciones y commits en inglés.
- **Fechas**: se guardan en UTC; se muestran con `src/lib/dates.ts` (locale `es`, zona
  `America/Mexico_City`). Las fechas de calendario (sin hora) viajan como `AAAA-MM-DD` y se
  guardan a las 12:00 UTC (`dateOnlyToDate` / `dateToDateOnly` de shared) para que nunca se
  recorran un día.
- **Logs** sin datos personales: solo ids. Pino redacta las rutas de `REDACTED_LOG_PATHS` y los
  errores pasan por `scrubText` (correos, valores de llaves duplicadas, textos entre comillas).
  Sentry (API y web) solo con `SENTRY_DSN`/`VITE_SENTRY_DSN`; en Sentry 11 `sendDefaultPii` es
  `dataCollection`, y ahí todo va apagado.
- **Producción**: la API no arranca en `production` con `COOKIE_SECURE=false`, orígenes sin
  `https://`, Swagger encendido o correo de consola (`productionProblems` en `env.ts`). El límite
  de intentos de login vive en MongoDB (`MongoThrottlerStorage`) para que las 2 instancias lo
  compartan. La CSP de la web está en `apps/web/vercel.json`.
- **Arranque de la web**: el código que corre al inicio (auth, layout, rutas) importa de
  `@siseep/shared/core` (sin zod). Las pantallas van en los chunks de `src/portals/`.
- **Colores**: primario `#1F3A7A`; campos formativos en `FIELD_COLORS` (`packages/shared`).
- **Mobile-first**: diseña a 360 px; barra inferior en celular, barra lateral desde 1024 px (`lg`).
  Objetivos táctiles de al menos 44 px.
- **Commits convencionales** (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`), una rama
  por etapa (`etapa-N-nombre`) y PR a `main`.

## Regla de pruebas

**Las pruebas de permisos y del motor de cálculo nunca se borran ni se saltan** (`.skip`, `.only`,
`xit`, comentarios, umbrales relajados). Si una falla, se corrige el código, no la prueba. Estas
pruebas están marcadas con el comentario `Permission tests: never delete or skip`, y las doradas
del motor (`packages/shared/test/grading.test.ts`: las 80 calificaciones del Periodo I del 5°B contra
el Excel) con `GOLDEN TESTS OF THE GRADING ENGINE`. Si el motor cambia y una dorada falla, el que
está mal es el motor.
