# CLAUDE.md

Sistema web de evaluación escolar para la Esc. Prim. Fed. Dr. Salvador Allende T.M. (Colima, Col.).
**La especificación es [docs/plan.md](docs/plan.md)**: léela antes de cada etapa y no implementes
nada de etapas posteriores a la que se pide.

## Estructura del repo

```text
apps/
  api/                 NestJS 11 + Mongoose 8. Un módulo por dominio en src/<dominio>/
    src/auth/          login, refresh con rotación, guards globales (JwtAuthGuard, PoliciesGuard)
    src/common/        filtro global de errores, decoradores (@Public, @CheckPolicies, @CurrentUser)
    src/config/        validación zod del .env (env.ts)
    src/scripts/       seed.ts
    test/              e2e con Jest + Supertest + mongodb-memory-server (replica set)
    Dockerfile         imagen de producción (incluye Chromium para Puppeteer)
  web/                 React 19 + Vite + Tailwind 4 + shadcn/ui
    src/auth/          AuthProvider, guards de rutas por rol, selector de rol
    src/lib/           api-client (interceptor de refresh), fechas (es, America/Mexico_City)
    src/components/ui/ componentes estilo shadcn (se copian, no se instalan)
    src/pages/         pantallas; rutas en src/routes.tsx
packages/
  shared/              esquemas zod, tipos, enums (sección 4), colores, reglas CASL (defineAbilityFor)
  eslint-config/       ESLint compartido (base y react)
  tsconfig/            tsconfig base, nest, react y library
scripts/dev.mjs        orquesta `pnpm dev` (Mongo + seed + api + web)
docs/                  plan.md (especificación) y deploy.md (staging)
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

- **Mongo local**: se usa el MongoDB que ya corre en `127.0.0.1:27017`, compartido con otros
  proyectos; SISEEP solo usa la base `siseep`. Hoy es **standalone** (sin transacciones): la
  etapa 0 no las necesita, pero **antes de la etapa 1** hay que convertirlo a replica set
  (`replication.replSetName: rs0` en `mongod.cfg` + `rs.initiate()`) y agregar
  `?replicaSet=rs0` a `MONGODB_URI`. Las pruebas no dependen de esto: usan su propio replica
  set en memoria. Con `DEV_START_MONGO=true`, `pnpm dev` levanta un Mongo propio (Docker en
  27018 o `.data/mongo`).
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
  de `packages/shared/src/abilities.ts`. El frontend solo oculta botones; el backend decide.
- **Alcance de datos**: toda consulta se filtra por `schoolId` y por el alcance del usuario
  (grupos asignados, alumnos vinculados). Nunca confíes en ids del frontend sin revisar el alcance.
- **Errores**: lanza `AppException` / `Errors.*` (`src/common/app.exception.ts`). La API responde
  siempre `{ statusCode, code, message, details? }` con `message` en español.
- **Idioma**: textos de UI y mensajes de error en español de México; código, nombres de
  variables, colecciones y commits en inglés.
- **Fechas**: se guardan en UTC; se muestran con `src/lib/dates.ts` (locale `es`, zona
  `America/Mexico_City`).
- **Logs** sin datos personales: solo ids.
- **Colores**: primario `#1F3A7A`; campos formativos en `FIELD_COLORS` (`packages/shared`).
- **Mobile-first**: diseña a 360 px; barra inferior en celular, barra lateral desde 1024 px (`lg`).
  Objetivos táctiles de al menos 44 px.
- **Commits convencionales** (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`), una rama
  por etapa (`etapa-N-nombre`) y PR a `main`.

## Regla de pruebas

**Las pruebas de permisos y del motor de cálculo nunca se borran ni se saltan** (`.skip`, `.only`,
`xit`, comentarios, umbrales relajados). Si una falla, se corrige el código, no la prueba. Estas
pruebas están marcadas con el comentario `Permission tests: never delete or skip` (y, desde la
etapa 3, las doradas del motor en `packages/shared`).
