/**
 * 技术方案-下一代ERP账本 §15 断言 6：模型可调用的工具面上，没有写 `said` 的接口。
 *
 * `said` 是「人说的」——账上最贵的那一种行，因为它是唯一能拿去对质一个人的证据。模型能
 * 起草一切，但只要有模型参与产生，这一行就是 `did`（§2.1 判别规则 2）：一个能以操作者
 * 名义落行的工具，等于让模型替人签字。
 *
 * 锁的形状：凡是定义模型工具（`defineTool(`）的源文件，写下的每一个 `actor:` 只能是
 * agent 或 system。已知的唯一例外（G5，见 §12）钉在下面——修好它时这条会变红，提醒
 * 把技术方案里那一行一起改掉。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const NEXT = new URL('../../', import.meta.url).pathname

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'client' ? [] : sources(path)
    return /\.tsx?$/u.test(name) ? [path] : []
  })
}

/** 每个包 src 下定义了模型工具的文件。按字节读：有的文件里有 NUL，grep 会把它当二进制跳过。 */
function toolFiles(): string[] {
  return readdirSync(NEXT)
    .map(name => join(NEXT, name, 'src'))
    .filter(dir => { try { return statSync(dir).isDirectory() } catch { return false } })
    .flatMap(sources)
    .filter(path => readFileSync(path, 'utf8').includes('defineTool('))
}

describe('模型工具面上没有写 said 的接口 (§15-6)', () => {
  it('定义模型工具的文件里，每一个 actor 都是 agent 或 system', () => {
    const files = toolFiles()
    // 工具面散在三个包里；少扫一个包，这条断言就成了一层皮肤。
    expect(files.some(path => path.includes('/objects/src/'))).toBe(true)
    expect(files.some(path => path.includes('/tools/src/'))).toBe(true)
    expect(files.some(path => path.includes('/pledger/src/'))).toBe(true)
    const offenders = files.flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return [...source.matchAll(/\bactor:\s*([^\n]{0,60})/gu)]
        .map(match => match[1] ?? '')
        .filter(rest => !/^\{\s*kind:\s*'(agent|system)'\s*\}/u.test(rest))
        .map(rest => `${path.slice(NEXT.length)}: actor: ${rest}`)
    })
    expect(offenders).toEqual([])
  })

  /*
    G5（§12）：`commitment_handoff` 是模型工具，它调的 `reissueEdge` 以桌面操作者的名义落
    `commitment/opened` 与 `commitment/transferred`——模型参与产生的 said 行。

    不能就地把 actor 改成 agent：承诺族从出生事件的 actor 盖 `delegatedBy`（验收权），
    缺了它 `ownsCommitment` 放行任何人——那会把一个记账问题变成一个权限放宽。正解要把
    委派者写进 data、并定下移交话语该以谁的口吻出站（#58/#59/#63 都在这里），由人拍板。
  */
  it('已知例外 G5 仍在：commitment_handoff → reissueEdge 以操作者名义落行（修好时删掉这一条）', () => {
    const handoff = readFileSync(join(NEXT, 'objects/src/commitment/handoff.ts'), 'utf8')
    const tools = readFileSync(join(NEXT, 'objects/src/commitment/tools.ts'), 'utf8')
    expect(handoff).toMatch(/export async function reissueEdge[\s\S]*actor: ctx\.yzjCards\.desktopActor\(\)/u)
    expect(tools).toMatch(/name: 'commitment_handoff'[\s\S]*await reissueEdge\(ctx/u)
  })
})
