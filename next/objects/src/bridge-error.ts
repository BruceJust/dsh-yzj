/**
 * 一次 CLI 失败到底为什么失败 —— 从**真结果**里读，不从我想象的形状里读。
 *
 * 这个文件是一次自审的产物。我在三处写了 `result.error ?? '写入失败'`——而
 * `YzjRunResult` **根本没有 `error` 这个字段**（它有 `stderr` / `exitCode` /
 * `timedOut`）。TS 没拦住：我在参数上自己声明了一个带 `error?` 的结构类型，真结果多
 * 出来的字段被结构类型接受了。单元测试也没拦住：我的假 bridge 恰好按我想象的形状造，
 * **假的和错的互相印证**。
 *
 * 后果不是崩溃，是**所有失败提示都退化成那句兜底**：整个会话我一直在写「说清为什么」
 * 的注释，而线上真正跑起来的时候，一句为什么都说不出。
 */

/** 从一次 CLI 结果里读出人能看懂的失败原因。 */
export function failureOf(result: {
  readonly stderr?: string
  readonly exitCode?: number | null
  readonly timedOut?: boolean
}, fallback: string): string {
  if (result.timedOut === true) return `${fallback}（超时）`
  const stderr = (result.stderr ?? '').trim()
  if (stderr !== '') {
    // CLI 的报错常是多行带 usage；第一行才是原因，后面是它在教你怎么用。
    const first = stderr.split('\n').map(line => line.trim()).find(line => line !== '')
    return first === undefined ? fallback : first.slice(0, 200)
  }
  const code = result.exitCode
  return code === undefined || code === null || code === 0
    ? fallback
    : `${fallback}（退出码 ${String(code)}）`
}
