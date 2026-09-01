/**
 * 私账合同面板 —— **判断力档案硬合同与场所合同面板同构** (v2.1 = #61 澄清②).
 *
 * 上一版把五条硬项做成了 Header 上的一排 chips。chips 说得出**是什么**，说不出
 * **为什么改不了**——而后者才是一份合同和一句标语的分别。**「说明文字占位同罪」
 * 对 chips 自身适用**：一句「仅你可见」点不开，人只能选择信或不信。
 *
 * 所以它变成一个面板，语法与场所合同**同一族**：
 *
 * - **硬区**：五硬项 + 持镜人。每条列的是**机械保证形态**（存储分离 / import 禁令 /
 *   无查询形态 / policy / 参数面）——陈列「为什么改不了」，不是「请勿修改」。一条
 *   guard 拦得住而面板说不清的规矩，和一条没人执行的规矩一样不可信。
 * - **软区**：**换挡台参数**（全局日配额 / 沉降天数 / 折叠阈值 / 降频阈值）。可调项
 *   恰是软合同的同构位——面板只读陈列 + 指路，改在金库里，人签发。
 *
 * 与场所合同**唯一的语法差别**，也是这份合同的全部特殊性：
 *
 * > **agent 无提议权。** 场所合同的软项 agent 可以提议修改；这一份不行——
 * > **另一半签署人是你自己，没有对方代表可以递案。**
 *
 * 这不是一条运行时检查，是一处**缺席**：`pledger_register` 的动作枚举里没有
 * 「改配额」「改沉降」这些值（断言 ㉘ 扫这个枚举），于是模型连提议的通道都没有。
 */

import type { Context } from '@deepseek-ai/cordis'
import { FATIGUE_LIMIT } from './invite.ts'
import { QUOTA_RANGE, quotaOf } from './ring.ts'
import { CONTRACT_CHIPS } from './vault.ts'
import { FOLD_THRESHOLD, SETTLE_DAYS } from './types.ts'

/** 硬区一行。`guarantee` 是**形态的名字**，`how` 是这一条具体落在哪儿。 */
export interface VaultHardTerm {
  readonly label: string
  /** 机械保证的**形态**：存储分离 / import 禁令 / 无查询形态 / policy / 参数面。 */
  readonly guarantee: string
  readonly how: string
}

/** 软区一行 —— 可调，但**只由人在金库里调**。 */
export interface VaultSoftTerm {
  readonly label: string
  /** 当前值，人读得懂的样子。 */
  readonly value: string
  /** 改在哪儿。说不出在哪儿改的「可调」，和不可调没有分别。 */
  readonly where: string
  /** 调它会改变什么——参数入 dogfood 观测项，所以两个方向的代价都要说。 */
  readonly cost: string
}

export interface VaultContract {
  readonly hard: readonly VaultHardTerm[]
  readonly soft: readonly VaultSoftTerm[]
  /** 这一份合同的另一半签署人。 */
  readonly signedBy: string
  /** agent 在这份合同上没有的那一样东西。 */
  readonly agentMayPropose: false
  readonly note: string
}

/**
 * 每一条硬项的**机械保证形态**.
 *
 * 与 {@link CONTRACT_CHIPS} 按 label 对齐——两份字面只写一次（chips 是这个面板的
 * 入口摘要，不是它的第二份副本）。
 */
const GUARANTEE_OF: Readonly<Record<string, string>> = {
  仅你可见: 'policy · viewer 单态',
  不入组织图: 'schema 面 · 组织图事件里没有这个字段的位置',
  '组织不可导出 · 本人可取走': 'policy · 审计重放不挂这个源；目录自包含',
  永不绩效: '无查询形态 · 窗口必填，返回类型里没有判词的位置',
  审计不可触及: 'policy · 导出投影的过滤器根本不认识这个 store',
  '耦合单向：图 → 金库': 'import 禁令 · 组织侧包的源码里不出现 pledger',
  '金库 ≠ 记忆': 'import 禁令（双向）· 蒸馏器无 pgraph，pledger 无 memory',
  持镜人: '参数面 · 生成器的签名里没有 pgraph 句柄（门读账，笔不读账）',
}

export function vaultContract(ctx: Context): VaultContract {
  const quota = quotaOf(ctx)
  return {
    hard: CONTRACT_CHIPS.map(chip => ({
      label: chip.label,
      guarantee: GUARANTEE_OF[chip.label] ?? '（这一条还没写出它的机械保证——那本身就是问题）',
      how: chip.how,
    })),
    /*
      软区四条 = 换挡台参数。**两个方向的代价都写出来**：

      沉太快是藏事，沉太慢是堆积；配额太低是听不见自己，太高是被自己烦。一个只说
      「调大更宽松」的参数面，会让人一路调到底然后关掉整个功能。
    */
    soft: [
      {
        label: '全局日配额',
        value: quota === 0 ? '0（全关邀约）' : `${String(quota)} / 天（上限 ${String(QUOTA_RANGE.max)}）`,
        where: '金库 · 配额行',
        cost: '调低：这一类判断你不再被问起，也就不再有对表的机会；'
          + '调高：五个入口各自克制，合起来仍然是骚扰。',
      },
      {
        label: '沉降天数',
        value: `${String(SETTLE_DAYS)} 天`,
        where: '（P1 固定，随 dogfood 观测调整）',
        cost: '沉太快=藏事：还没来得及对表就不再打扰；沉太慢=堆积，而堆积是催办的被动形态。',
      },
      {
        label: '折叠阈值',
        value: `${String(FOLD_THRESHOLD)} 张`,
        where: '（P1 固定）',
        cost: '平铺一屏未答会自己长出欠账感；折得太狠则最近的语境也看不见。',
      },
      {
        label: '族级降频阈值',
        value: `连续 ${String(FATIGUE_LIMIT)} 次不立即停问`,
        where: '金库 · 邀约频率行（重开的主权在你）',
        cost: '人用脚投票就是应答；而停得太早，一时不想聊会被当成永远不想聊。',
      },
    ],
    signedBy: '你自己',
    agentMayPropose: false,
    note: '场所合同的软项 agent 可以提议修改，这一份不行——**另一半签署人是你自己，'
      + '没有对方代表可以递案**。这不是一条运行时检查，是一处缺席：模型工具的动作枚举里'
      + '没有这些参数，连提议的通道都不存在。',
  }
}
