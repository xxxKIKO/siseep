# Despliegue de staging

Arquitectura de staging:

```text
Navegador ──HTTPS──▶ Vercel (web estática)
                       └─ /api/*  ──rewrite──▶ Railway (API NestJS, Docker) ──▶ MongoDB Atlas
```

La web y la API se ven desde **el mismo dominio** (el de Vercel). Vercel reenvía `/api/*` a
Railway. Es necesario porque la cookie del refresh token es `SameSite=Strict`: si el navegador
hablara directo con `*.railway.app`, la cookie no viajaría y la sesión se perdería al recargar.

## Local vs. staging/producción

|               | Local                                                                 | Staging / producción                                 |
| ------------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| MongoDB       | Tu MongoDB en `127.0.0.1:27017`, base `siseep` (standalone por ahora) | Atlas (replica set)                                  |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/siseep`                                    | `mongodb+srv://…/siseep?retryWrites=true&w=majority` |
| Correo        | `MAIL_DRIVER=console` (se imprime en el log)                          | `MAIL_DRIVER=resend`                                 |
| Web → API     | Proxy de Vite (`/api` → `localhost:PORT`)                             | Rewrite de Vercel (`/api` → Railway)                 |
| Secretos      | `.env` (no se sube a git)                                             | Variables de Railway                                 |

Nada del código cambia entre ambientes: solo las variables. La API avisa en el log si el
MongoDB al que se conecta no es replica set (en staging/producción lo marca como error).

## Lo que tienes que hacer a mano

### 1. MongoDB Atlas

1. Crea una cuenta en <https://cloud.mongodb.com> y un proyecto `siseep`.
2. Crea un cluster. Para staging basta el gratuito **M0**; producción usará **M10** (etapa 6).
   Región sugerida: `AWS / us-east-1` o la más cercana a la de Railway.
3. _Database Access_ → **Add New Database User**: usuario `siseep-staging` con contraseña
   generada y rol **Read and write to any database**.
4. _Network Access_ → **Add IP Address** → `0.0.0.0/0` (Railway no tiene IP fija en el plan
   básico). La contraseña larga y TLS protegen el acceso.
5. _Connect_ → _Drivers_ → copia la cadena y agrégale el nombre de la base:
   `mongodb+srv://siseep-staging:<contraseña>@<cluster>.mongodb.net/siseep?retryWrites=true&w=majority`

Atlas siempre es un replica set, así que las transacciones funcionan.

### 2. Resend (correo)

1. Crea una cuenta en <https://resend.com>.
2. Para probar, puedes enviar desde `onboarding@resend.dev`, pero **solo llega al correo de tu
   cuenta**. Para enviar a cualquier persona, verifica un dominio en _Domains_ (registros DNS).
3. _API Keys_ → **Create API Key** con permiso _Sending access_. Guárdala para el paso 3.

### 3. Railway (API)

1. Crea una cuenta en <https://railway.app> y conecta tu GitHub.
2. **New Project → Deploy from GitHub repo →** `xxxKIKO/siseep`.
3. Railway lee `railway.toml` de la raíz: construye con `apps/api/Dockerfile` y usa
   `/api/v1/health` como healthcheck. No cambies el _Root Directory_ (debe ser la raíz del repo).
4. En _Settings → Source_ elige la rama que se despliega (`main`, o `etapa-0-cimientos` para probar).
5. En _Variables_, pega estas (ver tabla abajo):

   ```env
   NODE_ENV=staging
   LOG_LEVEL=info
   MONGODB_URI=mongodb+srv://...            # paso 1
   JWT_ACCESS_SECRET=...                    # genera uno nuevo (comando abajo)
   JWT_ACCESS_TTL=900
   REFRESH_TOKEN_TTL_DAYS=30
   COOKIE_SECURE=true
   WEB_ORIGIN=https://<tu-proyecto>.vercel.app
   WEB_URL=https://<tu-proyecto>.vercel.app
   TRUST_PROXY=2
   SWAGGER_ENABLED=true
   MAIL_DRIVER=resend
   MAIL_FROM=Evaluación Allende <no-responder@tu-dominio>
   RESEND_API_KEY=re_...                    # paso 2
   SEED_ADMIN_EMAIL=...
   SEED_ADMIN_PASSWORD=...
   SEED_DIRECTOR_EMAIL=...
   SEED_DIRECTOR_PASSWORD=...
   SEED_DIRECTOR_FIRST_NAME=...
   SEED_DIRECTOR_LAST_NAME=...
   SEED_TEACHER_EMAIL=...
   SEED_TEACHER_PASSWORD=...
   ```

   No definas `PORT`: Railway lo asigna y la API lo lee.

   Genera el secreto JWT con:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

6. _Settings → Networking → Generate Domain_. Anota la URL (`https://xxxx.up.railway.app`).
7. Cuando el despliegue esté en verde, corre el seed **una vez** desde _el servicio → ⋯ →
   Shell_ (o con la CLI: `railway run --service api node dist/scripts/seed.js`):

   ```bash
   node dist/scripts/seed.js
   ```

8. Comprueba `https://xxxx.up.railway.app/api/v1/health` → `{"status":"ok","db":"up"}`.

### 4. Vercel (web)

1. En [apps/web/vercel.json](../apps/web/vercel.json) reemplaza
   `https://REEMPLAZA-CON-TU-API.up.railway.app` por la URL de Railway del paso 3.6, haz commit
   y push.
2. Crea una cuenta en <https://vercel.com>, **Add New → Project** e importa `xxxKIKO/siseep`.
3. Configura:
   - **Root Directory**: `apps/web`
   - Framework: Vite (los comandos de install/build salen de `vercel.json`)
   - Node.js: 22.x (_Settings → General_)
   - Variables de entorno: ninguna (la web llama a `/api/v1` en su propio dominio).
4. Despliega y anota el dominio (`https://<tu-proyecto>.vercel.app`). Si es distinto del que
   pusiste en `WEB_ORIGIN`/`WEB_URL` de Railway, corrígelo allá y redespliega la API.

### 5. GitHub

- La CI (`.github/workflows/ci.yml`) corre sola en cada PR: no requiere secretos.
- Recomendado: _Settings → Branches → Add rule_ para `main` con **Require status checks to pass**
  (`Lint, typecheck, test y build` e `Imagen Docker de la API`).

## Prueba de humo en staging

1. Abre `https://<tu-proyecto>.vercel.app` → pantalla de login.
2. Entra con el admin del seed → `/admin` con "Próximamente".
3. Recarga la página: la sesión debe seguir abierta (la cookie viaja a través del rewrite).
4. Entra como la maestra y abre `/admin` a mano → te regresa a `/maestro`.
5. "Olvidé mi contraseña" con tu correo → debe llegar el enlace (Resend).
6. `https://<tu-proyecto>.vercel.app/api/docs` muestra Swagger.

## Variables de la API

| Variable                                         | Obligatoria  | Ejemplo staging                       | Notas                                                                             |
| ------------------------------------------------ | ------------ | ------------------------------------- | --------------------------------------------------------------------------------- |
| `NODE_ENV`                                       | sí           | `staging`                             | `development`, `test`, `staging`, `production`                                    |
| `PORT`                                           | no           | (Railway)                             | 3000 por defecto                                                                  |
| `LOG_LEVEL`                                      | no           | `info`                                |                                                                                   |
| `MONGODB_URI`                                    | sí           | `mongodb+srv://…/siseep`              | Debe ser replica set                                                              |
| `JWT_ACCESS_SECRET`                              | sí           | 64 caracteres aleatorios              | Mínimo 32. Distinto por ambiente                                                  |
| `JWT_ACCESS_TTL`                                 | no           | `900`                                 | Segundos                                                                          |
| `REFRESH_TOKEN_TTL_DAYS`                         | no           | `30`                                  |                                                                                   |
| `COOKIE_SECURE`                                  | no           | `true`                                | Siempre `true` fuera de local                                                     |
| `WEB_ORIGIN`                                     | sí           | `https://x.vercel.app`                | CORS; varios separados por coma                                                   |
| `WEB_URL`                                        | sí           | `https://x.vercel.app`                | Para los enlaces de los correos                                                   |
| `TRUST_PROXY`                                    | sí           | `2`                                   | Saltos de proxy (Vercel + Railway) para obtener la IP real del límite de intentos |
| `SWAGGER_ENABLED`                                | no           | `true`                                | En producción se puede apagar                                                     |
| `THROTTLE_LOGIN_LIMIT` / `_TTL_MS` / `_BLOCK_MS` | no           | `5` / `60000` / `900000`              |                                                                                   |
| `INVITATION_TTL_DAYS`                            | no           | `7`                                   |                                                                                   |
| `PASSWORD_RESET_TTL_MINUTES`                     | no           | `60`                                  |                                                                                   |
| `MAIL_DRIVER`                                    | sí           | `resend`                              | `console` solo en local                                                           |
| `MAIL_FROM`                                      | sí           | `Evaluación Allende <no-responder@…>` | Dominio verificado en Resend                                                      |
| `RESEND_API_KEY`                                 | con `resend` | `re_…`                                |                                                                                   |
| `SEED_*`                                         | para el seed |                                       | Contraseñas de 10+ caracteres; solo se usan al crear la cuenta                    |

## Notas

- **Límite de intentos**: se guarda en memoria de la instancia. Con una sola instancia en staging
  está bien. Si en producción hay 2 instancias (etapa 6), cada una cuenta por separado; ahí habrá
  que pasar el contador a Redis o a Mongo.
- **Puppeteer**: la imagen ya trae Chromium (`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`).
  Railway necesita al menos 1 GB de RAM cuando se generen boletas (etapa 4).
- **Comprobar `TRUST_PROXY`**: después de desplegar, intenta 6 logins fallidos desde tu celular
  con datos móviles y otros desde tu computadora. Solo debe bloquearse el dispositivo que falló.
  Si se bloquean los dos, el valor no es correcto: prueba con `1` o con `3`.
