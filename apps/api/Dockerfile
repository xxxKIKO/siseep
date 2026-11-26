# syntax=docker/dockerfile:1
# API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t siseep-api .
# Includes Chromium for Puppeteer (report cards in stage 4).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    # Tests are not run in the image: skip the 600 MB mongod download.
    MONGOMS_DISABLE_POSTINSTALL=1 \
    PUPPETEER_SKIP_DOWNLOAD=true
RUN corepack enable
WORKDIR /app

# ---- build -------------------------------------------------------------------
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @siseep/api...
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @siseep/shared build \
 && pnpm --filter @siseep/api build \
 && pnpm --filter @siseep/api deploy --prod --legacy /out \
 && mkdir -p /out/dist \
 && cp -r apps/api/dist/. /out/dist/

# ---- runtime -----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-noto-color-emoji ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
