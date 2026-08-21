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
    exclude: [
      ...configDefaults.exclude,
      // Claude Code worktrees nest under .claude/ inside this repo; their test
      // copies have no node_modules and must not be collected.
      '**/.claude/**',
      /*
        rc.8 遗留（v3.10 4h⑥）：这两条读的是**全局安装的** dsh workspace bundle，
        断言里面有一个二进制补丁打进去的测试钩子。8/20 全局升级之后钩子没了，两条
        就一直红着。

        补丁本身对新实例已无必要——`sidebar.workspaces` 被 next/ 的 surface 整列
        遮蔽，层级由我们自己渲染。所以这不是「待修的红」，是**随补丁一起退役的测试**。
        在 root 排除而不是改 `packages/*`：那条「旧包不改不删不 import」的铁律不为
        一次绿灯破例，而一直红着的两条会让「全绿」这个信号本身贬值。
      */
      '**/packages/ui-yzj/tests/workspace-hierarchy-core.client.spec.ts',
    ],
    server: {
      deps: {
        inline: ['@deepseek-ai/dsh-client-ui-primitives', 'katex'],
      },
    },
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
})
