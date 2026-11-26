import type { E2EGlobals } from './global-setup';

export default async function globalTeardown(): Promise<void> {
  const globals = (globalThis as unknown as { __E2E__?: E2EGlobals }).__E2E__;
  globals?.api.kill();
  await globals?.replSet.stop();
}
