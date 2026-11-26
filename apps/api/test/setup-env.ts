// Environment for e2e tests. The .env file is ignored when NODE_ENV=test.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_ACCESS_SECRET = 'test-secret-that-is-long-enough-1234567890';
process.env.WEB_ORIGIN = 'http://localhost:5173';
process.env.WEB_URL = 'http://localhost:5173';
process.env.MAIL_DRIVER = 'console';
process.env.SWAGGER_ENABLED = 'false';
process.env.THROTTLE_LOGIN_LIMIT = '5';
process.env.THROTTLE_LOGIN_TTL_MS = '60000';
process.env.THROTTLE_LOGIN_BLOCK_MS = '900000';

// Each test file gets its own database in the shared in-memory replica set (see global-setup.ts).
// ConfigModule validates the environment when AppModule is imported, so this must be set here.
const base = process.env.MONGO_TEST_BASE_URI;
if (base) {
  const uri = new URL(base);
  uri.pathname = `/e2e_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  process.env.MONGODB_URI = uri.toString();
}
