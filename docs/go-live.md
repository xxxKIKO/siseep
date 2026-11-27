# Checklist de salida a producción

Meta: el lunes 7 de diciembre la maestra Viry captura el Periodo II del 5°B en producción.
`[x]` = hecho y verificado en el repositorio · `[ ]` = pendiente (con quién lo resuelve).

## 1. Seguridad y permisos

- [x] Toda ruta declara `@CheckPolicies`, `@Authenticated` o `@Public`; una prueba recorre el router de Nest y falla si falta (`test/route-policies.e2e-spec.ts`).
- [x] Matriz de aislamiento por rol de la sección 2 con 2 grupos, 2 maestros titulares, maestro de materia, directora y 2 padres (`test/isolation-matrix.e2e-spec.ts`).
- [x] Padre A no ve al hijo de padre B: 404 en todos los `/me/children/*` (guardians, isolation-matrix, history-export).
- [x] CSP estricta, HSTS, `X-Robots-Tag: noindex` y `Permissions-Policy` en la web (`apps/web/vercel.json`); CSP `default-src 'none'` en la API sin Swagger.
- [x] CORS solo a `WEB_ORIGIN`; en producción la API no arranca con `http://`, localhost, `COOKIE_SECURE=false`, Swagger o correo de consola.
- [x] `robots.txt` con `Disallow: /` y meta `noindex`.
- [x] Logs sin datos personales (redacción en pino + `scrubText` en errores).
- [x] Límite de 5 intentos de login compartido entre instancias (MongoDB), probado con 2 instancias.
- [ ] **Sentry**: crear proyectos `siseep-api` y `siseep-web` y poner `SENTRY_DSN` / `VITE_SENTRY_DSN` (responsable del proyecto). El código ya está listo y sin PII.
- [ ] Correr las pruebas de permisos **contra producción** con usuarios de prueba y borrarlos después (tras el despliegue).

## 2. Infraestructura

- [ ] **Dominio** definido (pendiente de decidir; ver `docs/plan.md`, decisiones pendientes).
- [ ] Dominio en Vercel con HTTPS y rewrite `/api/*` → Railway de producción (`apps/web/vercel.json`).
- [ ] **Atlas M10** creado, usuario `siseep-prod`, respaldo diario con **retención de 7 días**.
- [ ] **Restauración probada una vez en staging** (fecha: ____).
- [ ] Railway producción con **2 instancias** y 1 GB por instancia (`railway.toml` ya lo pide), variables de `docs/deploy.md`.
- [x] Healthcheck `/api/v1/health`: MongoDB responde **y** Chromium listo (503 en producción si falta).
- [x] `pnpm migrate:prod`: índices + ciclo 2026-2027 con sus reglas; idempotente y probado (`test/indexes.e2e-spec.ts`). Railway la corre antes de cada despliegue.
- [x] Índices verificados con `explain()` (sin `COLLSCAN`): resumen del grupo, calificaciones por actividad, `/me/children`.
- [ ] Resend con dominio verificado y `MAIL_FROM` del dominio.
- [ ] Íconos de la PWA regenerados con el **logo real** de la escuela (`pnpm icons:build <logo>`); hoy usan el ícono genérico.

## 3. Funciones de la etapa 6

- [x] Historial por periodo: `GET /students/:id/history` (foto si está cerrado, en vivo si está abierto) y `GET /me/children/:id/history` (a la familia, boleta solo publicada). Gráfica de barras campo × periodo y tabla en la ficha del alumno y en el portal de padres.
- [x] Concentrado en Excel `GET /groups/:id/period-results.xlsx` (hoja Resumen + una por campo), botón en el cierre del maestro y en Periodos del admin. Probado: la columna Boleta coincide con el Excel original.
- [x] PWA: manifest "Evaluación Allende", color #1F3A7A, precache del shell, la API no se cachea; botón "Instalar en tu celular" en Mi cuenta.
- [x] Carga diferida: un chunk por portal; el arranque no carga zod (`@siseep/shared/core`).
- [ ] **Lighthouse móvil**: accesibilidad **100** en captura y portal de padres ✔; rendimiento **65–80** medido en local (`vite preview` + API + Mongo en la misma máquina), meta 85. Volver a medir en staging (CDN, brotli, HTTP/2); si no llega, siguiente paso: aligerar el arranque (menú del layout, `sonner`, `tailwind-merge`).
- [x] Manuales de una página: `docs/manual-maestro.md`, `manual-director.md`, `manual-padres.md`, `manual-admin.md` y sus PDF en `docs/pdf/` (`pnpm manuals:pdf` verifica que cada uno sea de una página).

## 4. Datos reales (día del lanzamiento)

Requieren producción en línea; se hacen en este orden:

- [ ] Revisar y guardar el **aviso de privacidad** con la dirección (deja de decir "PENDIENTE DE REVISIÓN").
- [ ] Escuela: logo, CCT, ciudad. Ciclo 2026-2027 (lo crea `migrate:prod`), Periodo I (31 ago–30 nov) y Periodo II con su fecha de entrega.
- [ ] Grupo 5°B con la maestra Viry como titular y los maestros de Inglés y Ed. Física.
- [ ] **Importar** el Excel del Periodo I del 5°B (`/admin/importar`) y revisar la vista previa.
- [ ] **Cerrar el Periodo I** y comparar la foto con las boletas entregadas (el concentrado en Excel facilita la comparación; las 80 calificaciones ya coinciden en las pruebas doradas).
- [ ] Publicar el Periodo I (si la dirección quiere que las familias lo vean) y dejar **abierto el Periodo II**.
- [ ] **Invitar** a la maestra Viry y a la directora desde `/admin/usuarios` (llega el correo con el enlace).
- [ ] Prueba de humo en el celular de la maestra: entrar, instalar la app, capturar una actividad de prueba y borrarla.

## 5. Después del lanzamiento

- [ ] Exportación semanal del concentrado a Excel como respaldo durante la transición (sección 9).
- [ ] Puede esperar: gráficas comparativas del grupo completo para la dirección; avisos por correo al publicar boletas.
