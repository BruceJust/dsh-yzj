/**
 * 台账栅栏的规格。
 *
 * 这一条不是排版洁癖。它拦的是一个**组合缺陷**：回写往目标文档尾部贴台账（对的），
 * 差距简报改读真身正文当判据（也是对的），合起来变成**系统拿自己的记账证明自己达标**。
 * 两个各自都通过了测试的东西，合起来撒谎——所以这里锁的是「合起来之后」的行为。
 *
 * 四件事，每一件都对应一种它会重新变坏的样子：
 *
 * - **判据截到线为止**：线以下那行「· …· 已完成」不能出现在成功标准里；
 * - **没线 ≠ 空台账**：`undefined` 说「还没立过线」，`''` 说「立过了，底下还没记账」
 *   ——分不清这两个，重启一次就多贴一条线；
 * - **认第一条线**：宁可多截一点（少判一条标准），不可把中间那段系统写的当成人写的；
 * - **线以上什么都没有 ≠ 文档是空的**：前者是「没人写过尺子」，一句能让人当场去补的话。
 */

import { describe, expect, it } from 'vitest'
import { FENCE_MARK, fenceLine, isFence, splitAtFence, withLedger } from '../src/fence.ts'

describe('台账栅栏', () => {
  it('没有线时，整段都是人写的', () => {
    const split = splitAtFence('成功标准一：三家竞品各出一页\n成功标准二：每页含定价与差异')
    expect(split.human).toBe('成功标准一：三家竞品各出一页\n成功标准二：每页含定价与差异')
    /*
      不是空串。

      `undefined` 说的是「这份文档还没有栅栏」——回写看到它才会去立一条；空串说的是
      「立过了，底下还没记过账」。把两者合并，每次回写都以为没立过，于是往一份全组在
      读的文档里一条接一条地贴栅栏。
    */
    expect(split.ledger).toBeUndefined()
  })

  it('有线时，线以下一律归系统', () => {
    const split = splitAtFence([
      '成功标准一：三家竞品各出一页',
      fenceLine('成功标准'),
      '· 拉三家竞品各一页 — 代少兵',
      '· 拉三家竞品各一页 — 代少兵 · 已完成',
    ].join('\n'))
    expect(split.human).toBe('成功标准一：三家竞品各出一页')
    expect(split.ledger).toBe('· 拉三家竞品各一页 — 代少兵\n· 拉三家竞品各一页 — 代少兵 · 已完成')
  })

  it('立过线但还没记账，台账是空串而不是没有', () => {
    expect(splitAtFence(`标准\n${fenceLine('成功标准')}`).ledger).toBe('')
  })

  it('线被人重新敲过一遍，照样认得出来', () => {
    // 认的是那几个字，不是破折号的个数——人复制、重排、换标点都还得认。
    const split = splitAtFence(`标准\n**${FENCE_MARK}**\n· 一条账`)
    expect(split.human).toBe('标准')
    expect(split.ledger).toBe('· 一条账')
  })

  it('两条线时认第一条 —— 宁可少判，不可误判', () => {
    /*
      人手抄了一份旧台账、或者线被复制成两条。取第一条意味着「线以下全归系统」，
      最坏是少判一条标准；取最后一条会把中间那段系统写的东西当成人写的标准，
      而那正是这个文件要防的事。
    */
    const split = splitAtFence([
      '真的标准',
      fenceLine('成功标准'),
      '· 一条账',
      fenceLine('成功标准'),
      '· 另一条账',
    ].join('\n'))
    expect(split.human).toBe('真的标准')
    expect(split.ledger).not.toContain('真的标准')
  })

  it('拼回去时，人写的那段原样在上面', () => {
    const composed = withLedger('周一 10 点，带上季度的数', '会议议程', '· 竞品对比 https://x')
    expect(composed.startsWith('周一 10 点，带上季度的数\n')).toBe(true)
    expect(isFence(composed.split('\n')[1] ?? '')).toBe(true)
    expect(composed.endsWith('· 竞品对比 https://x')).toBe(true)
    // 拼完再拆，两段都回得来——不然「已经写过了没有」就问不出答案。
    const back = splitAtFence(composed)
    expect(back.human).toBe('周一 10 点，带上季度的数')
    expect(back.ledger).toBe('· 竞品对比 https://x')
  })

  it('人什么都没写时，线仍然立着 —— 它告诉人该写在哪儿', () => {
    const composed = withLedger('', '会议议程', '· 竞品对比 https://x')
    expect(isFence(composed.split('\n')[0] ?? '')).toBe(true)
    expect(splitAtFence(composed).human).toBe('')
  })

  it('线上写着「写在这一行以上」 —— 人往尾部续写是本能', () => {
    expect(fenceLine('成功标准')).toContain('成功标准写在这一行以上')
    expect(fenceLine('会议议程')).toContain('会议议程写在这一行以上')
  })
})
