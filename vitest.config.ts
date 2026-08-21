import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

/**
 * Vitest config: resolve client-half packages to their TS source so specs
 * exercise the browser entry directly. The published runtime client is a shell
 * closure bundle, so defineStore is supplied by a focused local ESM double.
 */
const RUNTIME_STUB = fileURLToPath(new URL('./vitest.runtime-client.ts', import.meta.url))

/** Resolve one `next/` workspace package to its TypeScript source. */
const nextSource = (name: string): string => (
  fileURLToPath(new URL(`./next/${name}/src/index.ts`, import.meta.url))
)

export default defineConfig({
  resolve: {
    alias: {
      // The published runtime client is a shell closure, not importable ESM.
      // Component specs need only defineStore at runtime; types still resolve
      // from the package's declaration export during tsc.
      '@deepseek-ai/dsh-client-runtime/client': RUNTIME_STUB,
      // The next/ packages publish built entries; specs exercise the source so
      // `pnpm test` stays a single command with no build step in front of it.
      '@yzj-next/bridge': nextSource('bridge'),
      '@yzj-next/graph': nextSource('graph'),
      '@yzj-next/cards': nextSource('cards'),
      '@yzj-next/objects': nextSource('objects'),
      '@yzj-next/tools': nextSource('tools'),
      '@yzj-next/channel': nextSource('channel'),
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
