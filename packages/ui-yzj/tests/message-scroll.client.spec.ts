import { describe, expect, it } from 'vitest'
import { scrollTopAfterPrepend } from '../src/client/panel.tsx'

describe('scrollTopAfterPrepend', () => {
  it('keeps the previously visible message anchored after rows are prepended', () => {
    expect(scrollTopAfterPrepend(120, 800, 1200)).toBe(520)
  })

  it('does not move backward when content height is unchanged or smaller', () => {
    expect(scrollTopAfterPrepend(80, 800, 800)).toBe(80)
    expect(scrollTopAfterPrepend(80, 800, 700)).toBe(80)
  })

  it('never returns a negative scroll offset', () => {
    expect(scrollTopAfterPrepend(-20, 300, 300)).toBe(0)
  })
})
