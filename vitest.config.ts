import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Vitest config: resolve client-half packages to their TS source so specs
 * exercise the browser entry directly (the built lib/client.js artifacts are
 * closure-factory bundles that require the shell's `window.__ModuleLoader__`).
 * The harness checkout is the single source of truth for these paths.
 */
const HARNESS = fileURLToPath(new URL('../deepseek-harness/packages/client', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // runtime's lib/client.js is a closure-factory artifact requiring the
      // shell loader; its source is a plain ESM browser entry that vitest can
      // import directly. ui-primitives' lib/index.js is a plain ESM build and
      // resolves normally.
      '@deepseek-ai/dsh-client-runtime/client': `${HARNESS}/runtime/src/client/index.ts`,
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
})
