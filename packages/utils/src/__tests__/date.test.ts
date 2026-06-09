// packages/utils/src/__tests__/date.test.ts

import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../date'

const secondsAgo = (n: number) => new Date(Date.now() - n * 1000)
const secondsAhead = (n: number) => new Date(Date.now() + n * 1000)

describe('formatRelativeTime', () => {
  it('formats past dates with an "ago" suffix', () => {
    expect(formatRelativeTime(secondsAgo(5))).toBe('5 seconds ago')
    expect(formatRelativeTime(secondsAgo(2 * 3600))).toBe('2 hours ago')
    expect(formatRelativeTime(secondsAgo(3 * 86400))).toBe('3 days ago')
  })

  it('formats future dates with an "in" prefix', () => {
    expect(formatRelativeTime(secondsAhead(3 * 86400))).toBe('in 3 days')
    expect(formatRelativeTime(secondsAhead(2 * 3600))).toBe('in 2 hours')
  })

  it('uses singular units for a value of 1', () => {
    expect(formatRelativeTime(secondsAgo(3600))).toBe('1 hour ago')
    expect(formatRelativeTime(secondsAhead(86400))).toBe('in 1 day')
  })

  it('drops the direction in short mode', () => {
    expect(formatRelativeTime(secondsAgo(2 * 3600), true)).toBe('2h')
    expect(formatRelativeTime(secondsAhead(3 * 86400), true)).toBe('3d')
  })

  it('returns "-" for nullish or invalid input', () => {
    expect(formatRelativeTime(null)).toBe('-')
    expect(formatRelativeTime(undefined)).toBe('-')
    expect(formatRelativeTime('not a date')).toBe('-')
  })

  it('accepts strings and epoch numbers', () => {
    expect(formatRelativeTime(secondsAgo(3600).toISOString())).toBe('1 hour ago')
    expect(formatRelativeTime(secondsAgo(3600).getTime())).toBe('1 hour ago')
  })
})
