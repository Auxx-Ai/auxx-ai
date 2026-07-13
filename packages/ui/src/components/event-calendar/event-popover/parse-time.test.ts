// packages/ui/src/components/event-calendar/event-popover/parse-time.test.ts

import { describe, expect, it } from 'vitest'
import { parseTimeInput } from './parse-time'

describe('parseTimeInput', () => {
  it.each([
    ['9', { hours: 9, minutes: 0 }],
    ['09', { hours: 9, minutes: 0 }],
    ['9:30', { hours: 9, minutes: 30 }],
    ['930', { hours: 9, minutes: 30 }],
    ['1430', { hours: 14, minutes: 30 }],
    ['2pm', { hours: 14, minutes: 0 }],
    ['2:30pm', { hours: 14, minutes: 30 }],
    ['2.30', { hours: 2, minutes: 30 }],
    ['14:00', { hours: 14, minutes: 0 }],
    ['12am', { hours: 0, minutes: 0 }],
    ['12pm', { hours: 12, minutes: 0 }],
    ['  9:30  ', { hours: 9, minutes: 30 }],
    ['2 PM', { hours: 14, minutes: 0 }],
    ['2:30 pm', { hours: 14, minutes: 30 }],
    ['12', { hours: 12, minutes: 0 }],
    ['0', { hours: 0, minutes: 0 }],
  ])('parses %s', (input, expected) => {
    expect(parseTimeInput(input)).toEqual(expected)
  })

  it.each([
    '25',
    '99',
    'abc',
    '',
    '   ',
    '2400',
    '13pm',
    '0am',
    '9:60',
    '25:00',
    '12345',
  ])('rejects %s', (input) => {
    expect(parseTimeInput(input)).toBeNull()
  })
})
