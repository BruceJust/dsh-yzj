/**
 * CSV / TSV → 行列。
 *
 * 交付物最常是表格 (§7.5),而一张表在等宽字体里排成一堵墙是**认不出来**的:
 * 列对不齐,长的一格把整行顶开,人读不出第三列和第七列的关系。所以「能投影
 * 则投影」在这里落到最朴素的一件事上——把它画成表。
 *
 * 手写而不是拿一个库:引号规则一共三条,而这份代码只服务于**预览**——它不
 * 需要正确到能往回写。真正的多维表格走资源投影(schema + 记录窗口),不走
 * 这里。
 */

/**
 * 按分隔符切成行列,认引号。
 *
 * 三条规则,就是 RFC 4180 在预览这个用途下的全部:引号里的分隔符是内容、
 * 引号里的换行是内容、连着两个引号是一个引号。不认这三条的切法会在第一个
 * 带逗号的地址上崩掉——而地址列几乎总是存在。
 */
export function parseDelimited(text: string, separator: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let index = 0
  const source = text.replace(/\r\n?/gu, '\n')

  const endField = (): void => { row.push(field); field = '' }
  const endRow = (): void => { endField(); rows.push(row); row = [] }

  while (index < source.length) {
    const char = source[index] ?? ''
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 2; continue }
        quoted = false
        index += 1
        continue
      }
      field += char
      index += 1
      continue
    }
    if (char === '"' && field === '') { quoted = true; index += 1; continue }
    if (char === separator) { endField(); index += 1; continue }
    if (char === '\n') { endRow(); index += 1; continue }
    field += char
    index += 1
  }
  // 末尾没有换行也是一行——丢掉它就是丢掉最后一条记录。
  if (field !== '' || row.length > 0) endRow()
  return rows.filter(entry => entry.length > 1 || (entry[0] ?? '') !== '')
}

/** `.tsv` 用制表符,其余按逗号。 */
export function separatorFor(ext: string | undefined): string {
  return ext === 'tsv' || ext === 'tab' ? '\t' : ','
}
