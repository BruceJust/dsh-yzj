/**
 * 署名协议 —— **B2 从体验升格为协议** (设计 v4.27 / 技术方案 §8 B5②, 决策 #63).
 *
 * 寄生期 agent 顶着操作者的账号说话。群里没有它，没人分得清 Bruce 与 Bruce 的助理
 * ——这本就是 B2 显示名的初衷。#63 把它升成协议，因为它同时回答了第二个问题：
 *
 * - **对人 = 归因**：这句话是助理说的，不是 Bruce 亲口说的；
 * - **对同侪实例 = 互认凭据**：N 个操作者各带一个"云小助"进同一间屋子，实体多而名字
 *   唯一，agent 用人看得见的**同一条通道**发现彼此——不需要成员列表（F13 没有它）。
 *
 * 分诊① 回声抑制因此扩为**同侪回声**：带署名的消息永不进入受话判定，只作镜像源。
 * 否则 Bruce 的代发登记话语会被张三的在岗实例判为「叫的是我」→ 二次登记 + 二次 ack
 * = 幽灵承诺的多实例双胞胎（v3.23r 抓到的最重一处）。
 *
 * **一切实例出站路径无豁免**（段 4q⑦）：`client.send` 的 agent 出站、`yzj_im_message_send`
 * 工具直连 CLI 的出站，两条路都在这里签。这个模块住在 `objects` 而不是 `channel`，
 * 正因为工具那条路够不到通道。
 *
 * 署名是文本，可被复制、可被伪造。信任模型 = 组织成员（与触发者白名单同级）；
 * 伪造/误贴的最坏结果 = 错误让位即无人接单，**永不导向双写**——失效方向安全。
 */

/**
 * 协议里 agent 的公名。**常量，不是配置**：它是同侪互认的凭据，两个实例各配一个
 * 名字就认不出彼此了。触发词（`@next`/`@agent`）与它无关——那是叫它的方式，这是它
 * 落款的方式。
 */
export const SIGNATURE_AGENT = '云小助'

/** 落款行只认这个形状：`—— 云小助（操作者名）`，在消息**最后一个非空行**。 */
const SIGNATURE_LINE = /^——\s*(\S+?)（([^（）]+)）\s*$/u

export interface OutboundSignature {
  /** 协议公名——永远是 {@link SIGNATURE_AGENT}；留着是为了让读到的人不必再查。 */
  readonly agent: string
  /** 这个实例的操作者叫什么。openId 不在文本里——它在消息的 `fromOpenId` 上。 */
  readonly operator: string
}

/** 一条出站消息的落款行。 */
export function signatureLine(operatorName: string): string {
  return `—— ${SIGNATURE_AGENT}（${operatorName.trim() === '' ? '未署名' : operatorName.trim()}）`
}

/**
 * 给一条实例出站签名。已经签过的不再签（重投递、回声抑制后的补发都可能再过一次）。
 *
 * 落款用**空行**隔开正文：卡片正文的最后一行常常是 `[card#…]` 句柄，落款贴着它会让
 * 人把两行读成一句。
 */
export function signOutbound(text: string, operatorName: string): string {
  if (readSignature(text) !== undefined) return text
  const body = text.replace(/\s+$/u, '')
  return `${body}\n\n${signatureLine(operatorName)}`
}

/**
 * 读一条消息的落款。不是落款形状、或落款的公名不是本协议的，都当作没有署名。
 *
 * 只看最后一个非空行：人引用一条署名消息（"他说：…—— 云小助（张三）"）之后再写自己的
 * 话，落款就不在末尾——那是人的话，不是实例出站。
 */
export function readSignature(text: string): OutboundSignature | undefined {
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') continue
    const match = SIGNATURE_LINE.exec(line.trim())
    if (match === null || match[1] !== SIGNATURE_AGENT) return undefined
    return { agent: SIGNATURE_AGENT, operator: (match[2] ?? '').trim() }
  }
  return undefined
}

/** 正文，不带落款——渲染到桌面或摘要时用。没有落款就原样返回。 */
export function stripSignature(text: string): string {
  if (readSignature(text) === undefined) return text
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if ((lines[index] ?? '').trim() === '') continue
    return lines.slice(0, index).join('\n').replace(/\s+$/u, '')
  }
  return text
}
