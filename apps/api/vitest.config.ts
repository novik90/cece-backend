import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * NestJS DI relies on `design:paramtypes` metadata emitted for decorators.
 * Vitest's default esbuild transform does not emit it, so we transpile with
 * SWC (decoratorMetadata) — required for the e2e tests that boot the real app.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2021',
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
