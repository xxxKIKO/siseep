#!/usr/bin/env node
/**
 * `pnpm dev`: everything needed to work locally with a single command.
 *
 * 1. Creates .env from .env.example on first run (with a random JWT secret).
 * 2. Makes sure MongoDB is reachable at MONGODB_URI:
 *    - already running (your local mongod, Atlas, docker compose) → use it. A standalone server
 *      works but has no transactions (needed from stage 1), so a warning is printed;
 *    - not running and DEV_START_MONGO=true → starts one: `docker compose up -d --wait mongo` if
 *      Docker is available, otherwise a local replica set via mongodb-memory-server (.data/mongo);
 *    - not running otherwise → stops with instructions.
 * 3. Checks that the API port (PORT) and the web port (WEB_PORT) are free, so it can run next
 *    to other projects.
 * 4. Runs the seed when the database has no users yet.
 * 5. Starts api and web with Turborepo.
 *
 * `pnpm dev:db` only starts the database (step 2) and keeps it in the foreground.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbOnly = process.argv.includes('--db-only');
const isWindows = process.platform === 'win32';
const log = (message) => console.log(`\x1b[36m[dev]\x1b[0m ${message}`);
const warn = (message) => console.warn(`\x1b[33m[dev] Aviso:\x1b[0m ${message}`);
let startMongo = false;

function dbName(uri) {
  return new URL(uri).pathname.replace(/^\//, '') || 'test';
}

/** Fails fast with a clear message when another project already uses the port. */
async function ensurePortFree(port, variable, label) {
  // Vite listens on ::1 and Nest on 0.0.0.0: check both loopback addresses.
  const inUse = (await canConnect('127.0.0.1', port, 500)) || (await canConnect('::1', port, 500));
  if (inUse) {
    const extra = variable === 'WEB_PORT' ? ' (y WEB_ORIGIN / WEB_URL)' : '';
    throw new Error(
      `El puerto ${port} (${label}) ya está en uso, quizá por otro proyecto. ` +
        `Cambia ${variable} en .env${extra} o detén lo que lo usa.`,
    );
  }
}

function ensureEnvFile() {
  const envPath = join(root, '.env');
  if (existsSync(envPath)) return;
  copyFileSync(join(root, '.env.example'), envPath);
  const secret = randomBytes(48).toString('base64url');
  const content = readFileSync(envPath, 'utf8').replace(
    /^JWT_ACCESS_SECRET=.*$/m,
    `JWT_ACCESS_SECRET=${secret}`,
  );
  writeFileSync(envPath, content);
  log('Se creó .env a partir de .env.example (con un JWT_ACCESS_SECRET aleatorio).');
}

function readEnv() {
  const env = {};
  for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  // Like Nest and Vite: real environment variables win over .env.
  for (const key of Object.keys(env)) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function canConnect(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function dockerAvailable() {
  const result = spawnSync('docker', ['info'], { stdio: 'ignore', shell: isWindows });
  return result.status === 0;
}

/** Returns a stop function (or null when nothing was started by this script). */
async function ensureMongo(uri) {
  const parsed = new URL(uri);
  if (parsed.protocol === 'mongodb+srv:') {
    log('MONGODB_URI apunta a Atlas (mongodb+srv); no se levanta Mongo local.');
    return null;
  }
  const host = parsed.hostname || '127.0.0.1';
  const port = Number(parsed.port || 27017);

  if (await canConnect(host, port)) {
    if (await isReplicaSet(uri)) {
      log(`Usando el MongoDB (replica set) que ya corre en ${host}:${port}.`);
    } else {
      log(`Usando el MongoDB que ya corre en ${host}:${port} (base "${dbName(uri)}").`);
      warn(
        'Es standalone: las transacciones no están disponibles. La etapa 0 no las usa, ' +
          'pero desde la etapa 1 (importar Excel, cerrar periodo) hará falta un replica set.',
      );
    }
    return null;
  }

  if (!startMongo) {
    throw new Error(
      `No hay MongoDB escuchando en ${host}:${port}. Inicia tu MongoDB ` +
        '(acceso directo "MongoDB" en Inicio de Windows) y vuelve a correr pnpm dev. ' +
        'Si prefieres que pnpm dev levante uno propio, pon DEV_START_MONGO=true en .env.',
    );
  }

  if (dockerAvailable()) {
    log('Levantando MongoDB 7 (replica set rs0) con docker compose…');
    const result = spawnSync('docker', ['compose', 'up', '-d', '--wait', 'mongo'], {
      cwd: root,
      stdio: 'inherit',
      shell: isWindows,
    });
    if (result.status !== 0) throw new Error('docker compose no pudo levantar MongoDB.');
    return null;
  }

  log('Docker no está disponible: levantando MongoDB 7 local (replica set rs0) en .data/mongo…');
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const dbPath = join(root, '.data', 'mongo');
  mkdirSync(dbPath, { recursive: true });
  const replSet = await MongoMemoryReplSet.create({
    replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ port, dbPath, storageEngine: 'wiredTiger' }],
  });
  log(`MongoDB listo en ${host}:${port} (datos en .data/mongo).`);
  return async () => {
    await replSet.stop({ doCleanup: false, force: false });
  };
}

function mongoClient(uri) {
  const requireFromApi = createRequire(join(root, 'apps', 'api', 'package.json'));
  const { MongoClient } = requireFromApi('mongoose').mongo;
  return new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
}

async function isReplicaSet(uri) {
  const client = mongoClient(uri);
  try {
    await client.connect();
    const hello = await client.db('admin').command({ hello: 1 });
    return Boolean(hello.setName);
  } catch {
    return false;
  } finally {
    await client.close();
  }
}

async function hasUsers(uri) {
  const client = mongoClient(uri);
  try {
    await client.connect();
    return (await client.db().collection('users').estimatedDocumentCount()) > 0;
  } finally {
    await client.close();
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: isWindows });
  if (result.status !== 0) throw new Error(`Falló: ${command} ${args.join(' ')}`);
}

let stopMongo = null;

async function shutdown(code = 0) {
  if (stopMongo) {
    log('Deteniendo MongoDB local…');
    await stopMongo().catch(() => {});
    stopMongo = null;
  }
  process.exit(code);
}

async function main() {
  ensureEnvFile();
  const env = readEnv();
  if (!env.MONGODB_URI) throw new Error('Falta MONGODB_URI en .env');
  startMongo = env.DEV_START_MONGO === 'true';
  const apiPort = Number(env.PORT || 3000);
  const webPort = Number(env.WEB_PORT || 5173);

  stopMongo = await ensureMongo(env.MONGODB_URI);
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));

  if (dbOnly) {
    log('Solo base de datos. Ctrl+C para detenerla.');
    return;
  }

  await ensurePortFree(apiPort, 'PORT', 'API');
  await ensurePortFree(webPort, 'WEB_PORT', 'web');

  if (!(await hasUsers(env.MONGODB_URI))) {
    log('La base de datos está vacía: corriendo el seed…');
    run('pnpm', ['--filter', '@siseep/shared', 'build']);
    run('pnpm', ['--filter', '@siseep/api', 'seed']);
  }

  log(`Iniciando api (http://localhost:${apiPort}/api/v1) y web (http://localhost:${webPort})…`);
  const turbo = spawn('pnpm', ['exec', 'turbo', 'run', 'dev'], {
    cwd: root,
    stdio: 'inherit',
    shell: isWindows,
  });
  turbo.on('exit', (code) => void shutdown(code ?? 0));
}

main().catch((error) => {
  console.error(`\x1b[31m[dev]\x1b[0m ${error instanceof Error ? error.message : error}`);
  void shutdown(1);
});
