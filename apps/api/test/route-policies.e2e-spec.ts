import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { CHECK_POLICIES_KEY, IS_PUBLIC_KEY } from '../src/common/decorators';
import { createTestContext, type TestContext } from './helpers';

// Permission tests: never delete or skip (see CLAUDE.md).
describe('Every route declares its access rule (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('uses @CheckPolicies, @Authenticated or @Public on every route of every controller', () => {
    const modules = ctx.app.get(ModulesContainer);
    const scanner = new MetadataScanner();
    const reflector = new Reflector();
    const controllers = [...modules.values()].flatMap((m) => [...m.controllers.values()]);
    const missing: string[] = [];
    let routes = 0;

    for (const wrapper of controllers) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const prototype = Object.getPrototypeOf(instance) as object;
      const base = (Reflect.getMetadata(PATH_METADATA, metatype) as string | undefined) ?? '';
      for (const name of scanner.getAllMethodNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[name] as object;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (path === undefined) continue; // not a route
        routes++;
        const targets = [handler as never, metatype];
        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
        const policies = reflector.getAllAndOverride<unknown[]>(CHECK_POLICIES_KEY, targets);
        if (!isPublic && !policies?.length) {
          const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
          missing.push(`${method} /${base}/${path} (${metatype.name}.${name})`);
        }
      }
    }
    expect(routes).toBeGreaterThan(80);
    expect(missing).toEqual([]);
  });
});
