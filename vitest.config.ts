import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

/**
 * Vitest config: resolve client-half packages to their TS source so specs
 * exercise the browser entry directly. The published runtime client is a shell
 * closure bundle, so defineStore is supplied by a focused local ESM double.
 */
const RUNTIME_STUB = fileURLToPath(new URL('./vitest.runtime-client.ts', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // The published runtime client is a shell closure, not importable ESM.
      // Component specs need only defineStore at runtime; types still resolve
      // from the package's declaration export during tsc.
      '@deepseek-ai/dsh-client-runtime/client': RUNTIME_STUB,
    },
  },
  test: {
    // Claude Code worktrees nest under .claude/ inside this repo; their test
    // copies have no node_modules and must not be collected.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
    server: {
      deps: {
        inline: ['@deepseek-ai/dsh-client-ui-primitives', 'katex'],
      },
    },
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
})
