// apps/web/src/components/kopilot/hooks/__tests__/use-smooth-stream.test.ts

import { describe, expect, it } from 'vitest'
import { splitAtHorizon } from '../use-smooth-stream'

const WORDS = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

const TABLE = [
  '| Name | Status |',
  '| --- | --- |',
  '| Acme | active |',
  '| Globex | churned |',
].join('\n')

describe('splitAtHorizon', () => {
  it('splits plain prose into prefix + 12-word tail', () => {
    const text = WORDS(30)
    const { prefix, tail, prefixWordCount } = splitAtHorizon(text)
    expect(prefixWordCount).toBe(18)
    expect(prefix + tail).toBe(text)
    expect(tail.trim().split(/\s+/)).toHaveLength(12)
  })

  it('puts everything in the tail for short prose', () => {
    const text = WORDS(5)
    expect(splitAtHorizon(text)).toEqual({ prefix: '', tail: text, prefixWordCount: 0 })
  })

  it('holds the tail empty inside an open auxx fence', () => {
    const text = `${WORDS(20)}\n\`\`\`auxx:table\n{"columns": [`
    const split = splitAtHorizon(text)
    expect(split.tail).toBe('')
    expect(split.prefix).toBe(text)
  })

  it('holds the tail empty while streaming inside a table (mid-row)', () => {
    const text = `${WORDS(20)}\n\n| Name | Status |\n| --- | --- |\n| Acme | act`
    const split = splitAtHorizon(text)
    expect(split.tail).toBe('')
    expect(split.prefix).toBe(text)
  })

  it('keeps holding across the newline gap between table rows', () => {
    const text = `${WORDS(20)}\n\n${TABLE}\n`
    const split = splitAtHorizon(text)
    expect(split.tail).toBe('')
  })

  it('keeps holding while fewer than tailWords words follow the table', () => {
    const text = `${WORDS(20)}\n\n${TABLE}\n\nDone. Five more words here.`
    const split = splitAtHorizon(text)
    expect(split.tail).toBe('')
    expect(split.prefix).toBe(text)
  })

  it('resumes the tail once the table is more than tailWords words back', () => {
    const text = `${WORDS(5)}\n\n${TABLE}\n\n${WORDS(20)}`
    const { prefix, tail } = splitAtHorizon(text)
    expect(tail).not.toBe('')
    expect(tail).not.toContain('|')
    expect(prefix + tail).toBe(text)
  })

  it('holds when a table appears within the first tailWords words', () => {
    const text = `Accounts:\n\n| Name |\n| --- |\n| Acme |`
    const split = splitAtHorizon(text)
    expect(split.tail).toBe('')
    expect(split.prefix).toBe(text)
  })
})
