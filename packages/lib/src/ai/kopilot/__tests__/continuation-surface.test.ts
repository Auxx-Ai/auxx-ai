// packages/lib/src/ai/kopilot/__tests__/continuation-surface.test.ts
//
// Pure surface-restoration contract: request values always win; the persisted
// `_lastPage` / `_lastContext` fallback applies ONLY to continuation turns.

import {
  LAST_CONTEXT_KEY,
  LAST_PAGE_KEY,
  resolveContinuationSurface,
} from '../continuation-surface'

describe('resolveContinuationSurface', () => {
  const savedSurface = {
    [LAST_PAGE_KEY]: 'agents.builder',
    [LAST_CONTEXT_KEY]: { references: [{ kind: 'agent', id: 'a1' }] },
  }

  it('uses request values verbatim when present (non-continuation)', () => {
    const out = resolveContinuationSurface({
      requestPage: 'mail',
      requestContext: { references: [{ kind: 'thread', id: 't1' }] },
      isContinuation: false,
      domainState: savedSurface,
    })
    expect(out.page).toBe('mail')
    expect(out.context).toEqual({ references: [{ kind: 'thread', id: 't1' }] })
  })

  it('request values win even on a continuation', () => {
    const out = resolveContinuationSurface({
      requestPage: 'mail',
      requestContext: { references: [{ kind: 'thread', id: 't1' }] },
      isContinuation: true,
      domainState: savedSurface,
    })
    expect(out.page).toBe('mail')
    expect(out.context).toEqual({ references: [{ kind: 'thread', id: 't1' }] })
  })

  it('continuation with no request surface falls back to persisted state', () => {
    const out = resolveContinuationSurface({
      requestPage: undefined,
      requestContext: undefined,
      isContinuation: true,
      domainState: savedSurface,
    })
    expect(out.page).toBe('agents.builder')
    expect(out.context).toEqual({ references: [{ kind: 'agent', id: 'a1' }] })
  })

  it('non-continuation with no request surface never falls back (stays page-less)', () => {
    const out = resolveContinuationSurface({
      requestPage: undefined,
      requestContext: undefined,
      isContinuation: false,
      domainState: savedSurface,
    })
    expect(out.page).toBeUndefined()
    expect(out.context).toBeUndefined()
  })

  it('continuation with empty domainState yields undefined surface', () => {
    const out = resolveContinuationSurface({
      requestPage: undefined,
      requestContext: undefined,
      isContinuation: true,
      domainState: {},
    })
    expect(out.page).toBeUndefined()
    expect(out.context).toBeUndefined()
  })

  it('partial restore: request page present, context falls back', () => {
    const out = resolveContinuationSurface({
      requestPage: 'agents.builder',
      requestContext: undefined,
      isContinuation: true,
      domainState: savedSurface,
    })
    expect(out.page).toBe('agents.builder')
    expect(out.context).toEqual({ references: [{ kind: 'agent', id: 'a1' }] })
  })

  it('ignores non-string persisted page and non-object persisted context', () => {
    const out = resolveContinuationSurface({
      requestPage: undefined,
      requestContext: undefined,
      isContinuation: true,
      domainState: { [LAST_PAGE_KEY]: 42, [LAST_CONTEXT_KEY]: 'nope' },
    })
    expect(out.page).toBeUndefined()
    expect(out.context).toBeUndefined()
  })
})
