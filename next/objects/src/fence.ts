/**
 * 台账栅栏 —— 系统写进人的地方，一律写在一条分界线以下。
 *
 * 这条规矩是一次**组合缺陷**逼出来的：两个各自正确的东西合起来撒了谎。
 *
 * - 状态回写往目标文档尾部贴 `· 拉三家竞品各一页 — 代少兵 · 已完成`，对的：全组
 *   看的就是那份文档；
 * - 差距简报改读真身正文当判据，也是对的：副本只证明签发时刻人签了什么。
 *
 * 合起来：**系统自己记的账，被系统当成「成功标准」读了回去**。而 `goal_report` 的
 * 参数上写着 `criterion: quoted from the goal`——一个 agent 完全可能把那行「· …·
 * 已完成」当成一条标准，判 `met`，证据引它自己。整套设计最核心的一句是「引真对象，
 * 不引一个感觉」，而这是比引感觉更坏的一种：**引自己的记账当作达标的证据**。
 *
 * 同一个病在日程那边换了个形状：材料清单 `--description` 整段写下去，把会议主人
 * 写的议程**抹掉**。摩擦再分配里，「把材料链接一条条粘进日程」是损耗性摩擦，该归零；
 * 「会议主人写的议程」是主权性摩擦，**必须保留**。回写在目标文档里是追加，在日程
 * 描述里却是覆盖——同一件事两种做法，其中一种是错的。
 *
 * 所以一条线，两处共用：
 *
 * - **线以上是人的**：系统不覆盖它，也不把它当自己写的；
 * - **线以下是系统的**：系统只在这里写，而**读人类真相时一律截到线为止**。
 *
 * 线本身是一句人话，不是一个魔法标记：那份文档和那场会是人在读的，得让读到的人
 * 当场明白这以下不用改、以及自己该写在哪儿。认线只认 {@link FENCE_MARK} 这几个字，
 * 破折号多寡、前后空格、有人重新敲过一遍——都还认得出来。
 */

/** 认线只认这几个字。人重新敲一遍、改了破折号，都还认得出来。 */
export const FENCE_MARK = '以下由系统自动维护'

/**
 * 那条线长什么样。`above` 说的是**线以上该写什么**——这句话是给人看的，
 * 因为人往文档尾部续写是本能，而续在线以下会被系统当成自己的账覆盖掉。
 */
export function fenceLine(above: string): string {
  return `———— ${FENCE_MARK}，请勿手改；${above}写在这一行以上 ————`
}

/** 一行是不是那条线。 */
export function isFence(line: string): boolean {
  return line.includes(FENCE_MARK)
}

/**
 * 把一段正文拆成「人的」和「系统的」。
 *
 * 没有线就**整段都是人的**——`ledger` 是 `undefined` 而不是空串，两者差别要紧：
 * `undefined` 说的是「这里还没有栅栏」（该立一条），空串说的是「有栅栏，底下还没记
 * 过账」（别再立）。分不清这两个，重启一次就往一份全组在读的文档里多贴一条线。
 *
 * 认**第一条**线。人手抄了一份旧台账、或者线被复制成了两条，取第一条意味着「线以下
 * 全归系统」——多截了一点，最坏是少判一条标准；取最后一条则会把中间那段系统写的东西
 * 当成人写的标准，那正是这个文件要防的事。宁可少判，不可误判。
 */
export function splitAtFence(text: string): { human: string; ledger?: string } {
  const lines = text.split('\n')
  const at = lines.findIndex(line => isFence(line))
  if (at < 0) return { human: text }
  return {
    human: lines.slice(0, at).join('\n').trimEnd(),
    ledger: lines.slice(at + 1).join('\n').trim(),
  }
}

/**
 * 人的那段 + 线 + 系统的那段，拼成可以整段写回去的一份。
 *
 * 用在**一次写一整段**的地方（日程描述）。目标文档那边是一行一行追加的，拼不着
 * 整段——那里共用的是同一条线和同一个拆法，不是这个拼法。
 */
export function withLedger(human: string, above: string, ledger: string): string {
  const head = human.trim()
  return `${head === '' ? '' : `${head}\n`}${fenceLine(above)}\n${ledger}`
}
