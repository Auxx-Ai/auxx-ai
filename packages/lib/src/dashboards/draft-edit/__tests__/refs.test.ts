// packages/lib/src/dashboards/draft-edit/__tests__/refs.test.ts
//
// Widget/tab reference resolution. The four stages resolve in order, ambiguity
// is ALWAYS a refusal listing candidates (never a guess, because the canvas
// does not enforce unique titles), and a miss carries the near matches so the
// caller can retry without a second read.

import { describe, expect, it } from 'vitest'
import { BadRequestError, NotFoundError } from '../../../errors'
import {
  allWidgets,
  closestMatches,
  formatTabRef,
  formatWidgetRef,
  resolveTabRef,
  resolveWidgetRef,
} from '../refs'
import { doc, tab, widget } from './support/fixtures'

const sample = doc([
  tab('tab_1', 'Overview', [widget('wgt_1', 'Revenue by month'), widget('wgt_2', 'Open tickets')]),
  tab('tab_2', 'Support', [widget('wgt_3', 'Backlog')]),
])

describe('resolveWidgetRef', () => {
  it('matches an exact title and reports the tab it lives on', () => {
    const result = resolveWidgetRef(sample, 'Open tickets')
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().widget.id).toBe('wgt_2')
    expect(result._unsafeUnwrap().tab.id).toBe('tab_1')
    expect(result._unsafeUnwrap().matchedBy).toBe('title')
  })

  it('matches case-insensitively: a model reproduces the words, not the caps', () => {
    const result = resolveWidgetRef(sample, 'open TICKETS')
    expect(result._unsafeUnwrap().widget.id).toBe('wgt_2')
    expect(result._unsafeUnwrap().matchedBy).toBe('title-ci')
  })

  it('matches a unique title prefix', () => {
    const result = resolveWidgetRef(sample, 'Revenue')
    expect(result._unsafeUnwrap().widget.id).toBe('wgt_1')
    expect(result._unsafeUnwrap().matchedBy).toBe('prefix')
  })

  it('matches a raw id, so a tool result feeds straight back in', () => {
    const result = resolveWidgetRef(sample, 'wgt_3')
    expect(result._unsafeUnwrap().widget.title).toBe('Backlog')
    expect(result._unsafeUnwrap().matchedBy).toBe('id')
  })

  it('trims before resolving', () => {
    expect(resolveWidgetRef(sample, '  Backlog  ')._unsafeUnwrap().widget.id).toBe('wgt_3')
  })

  // THE property: two widgets may legitimately share a title, and guessing
  // between them silently edits the wrong one.
  it('refuses an ambiguous title and names every candidate with its id', () => {
    const ambiguous = doc([
      tab('tab_1', 'Overview', [widget('wgt_1', 'Revenue'), widget('wgt_2', 'Revenue')]),
    ])
    const result = resolveWidgetRef(ambiguous, 'Revenue')
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(BadRequestError)
    expect(error.message).toContain('wgt_1')
    expect(error.message).toContain('wgt_2')
    expect(error.details.candidates).toEqual(['wgt_1', 'wgt_2'])
  })

  it('refuses an ambiguous PREFIX too', () => {
    const ambiguous = doc([
      tab('tab_1', 'Overview', [
        widget('wgt_1', 'Revenue by month'),
        widget('wgt_2', 'Revenue MTD'),
      ]),
    ])
    expect(resolveWidgetRef(ambiguous, 'Revenue')._unsafeUnwrapErr()).toBeInstanceOf(
      BadRequestError
    )
  })

  // An exact id cannot be misread, so it beats an ambiguous prefix rather than
  // being refused alongside it.
  it('prefers an exact id over an ambiguous prefix', () => {
    const collide = doc([
      tab('tab_1', 'Overview', [widget('wgt_1', 'wgt'), widget('wgt_2', 'wgtx')]),
    ])
    expect(resolveWidgetRef(collide, 'wgt_2')._unsafeUnwrap().widget.title).toBe('wgtx')
  })

  it('returns the near matches on a miss', () => {
    const result = resolveWidgetRef(sample, 'Open tickts')
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(NotFoundError)
    expect(error.message).toContain('Did you mean')
    expect(error.details.closestMatches).toEqual(['Open tickets'])
  })

  it('lists what IS there when nothing is close', () => {
    const error = resolveWidgetRef(sample, 'zzzzzzzzzzzz')._unsafeUnwrapErr()
    expect(error.details.closestMatches).toEqual([])
    expect(error.message).toContain('Available:')
  })

  it('says so when the dashboard has no widgets at all', () => {
    const error = resolveWidgetRef(doc([tab('tab_1', 'Overview')]), 'Anything')._unsafeUnwrapErr()
    expect(error.message).toContain('no widgets')
  })

  it('refuses an empty ref', () => {
    expect(resolveWidgetRef(sample, '   ')._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })
})

describe('resolveTabRef', () => {
  it('resolves by title, case-insensitively, by prefix and by id', () => {
    expect(resolveTabRef(sample, 'Support')._unsafeUnwrap().tab.id).toBe('tab_2')
    expect(resolveTabRef(sample, 'support')._unsafeUnwrap().matchedBy).toBe('title-ci')
    expect(resolveTabRef(sample, 'Over')._unsafeUnwrap().tab.id).toBe('tab_1')
    expect(resolveTabRef(sample, 'tab_2')._unsafeUnwrap().matchedBy).toBe('id')
  })

  it('refuses an ambiguous tab title', () => {
    const ambiguous = doc([tab('tab_1', 'Sales'), tab('tab_2', 'Sales')])
    expect(resolveTabRef(ambiguous, 'Sales')._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('reports a miss with near matches', () => {
    const error = resolveTabRef(sample, 'Suport')._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(NotFoundError)
    expect(error.details.closestMatches).toEqual(['Support'])
  })
})

describe('formatWidgetRef / formatTabRef', () => {
  it('renders a unique title', () => {
    expect(formatWidgetRef(sample, 'wgt_1')).toBe('Revenue by month')
    expect(formatTabRef(sample, 'tab_2')).toBe('Support')
  })

  // A duplicated title would round-trip straight back into an ambiguity error,
  // so the id is the only honest rendering.
  it('falls back to the id when the title is not unique', () => {
    const ambiguous = doc([
      tab('tab_1', 'Overview', [widget('wgt_1', 'Revenue'), widget('wgt_2', 'revenue')]),
    ])
    expect(formatWidgetRef(ambiguous, 'wgt_1')).toBe('wgt_1')
  })

  it('falls back to the id for an untitled widget, and passes unknown ids through', () => {
    const untitled = doc([tab('tab_1', 'Overview', [widget('wgt_1', '')])])
    expect(formatWidgetRef(untitled, 'wgt_1')).toBe('wgt_1')
    expect(formatWidgetRef(sample, 'wgt_nope')).toBe('wgt_nope')
    expect(formatTabRef(sample, 'tab_nope')).toBe('tab_nope')
  })
})

describe('closestMatches', () => {
  it('suggests near misses only, nearest first', () => {
    expect(closestMatches('Reveue', ['Revenue', 'Backlog', 'Revenues'])).toEqual([
      'Revenue',
      'Revenues',
    ])
  })

  it('suggests nothing unrelated', () => {
    expect(closestMatches('Revenue', ['Backlog'])).toEqual([])
  })
})

describe('allWidgets', () => {
  it('flattens in document order, each with its tab', () => {
    expect(allWidgets(sample).map((p) => [p.widget.id, p.tab.id])).toEqual([
      ['wgt_1', 'tab_1'],
      ['wgt_2', 'tab_1'],
      ['wgt_3', 'tab_2'],
    ])
  })
})
