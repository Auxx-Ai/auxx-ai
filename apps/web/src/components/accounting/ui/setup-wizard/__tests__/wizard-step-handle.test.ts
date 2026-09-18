// apps/web/src/components/accounting/ui/setup-wizard/__tests__/wizard-step-handle.test.ts
//
// The shell's leave sequencing. Small surface, but both properties below were
// live defects: F7 was the missing await, and the always-truthy promise is the
// regression a careless "this need not be async" edit reintroduces.

import { describe, expect, it, vi } from 'vitest'
import { leaveCurrentPage, type WizardStepHandle } from '../wizard-step-handle'

/** A page whose `tryAdvance` resolves a tick later, like a real save does. */
function asyncHandle(answer: boolean, log: string[] = []): WizardStepHandle {
  return {
    tryAdvance: async () => {
      await Promise.resolve()
      log.push('saved')
      return answer
    },
  }
}

describe('leaveCurrentPage', () => {
  it('treats a page with no handle as safe to leave', async () => {
    // Most pages write immediately and register nothing.
    const advance = vi.fn()
    await leaveCurrentPage(null, 'next', advance)
    expect(advance).toHaveBeenCalledOnce()
  })

  it('passes the direction through to the page', async () => {
    const tryAdvance = vi.fn(() => true)
    await leaveCurrentPage({ tryAdvance }, 'exit', vi.fn())
    expect(tryAdvance).toHaveBeenCalledWith('exit')
  })

  it('honours a synchronous refusal, and a synchronous yes', async () => {
    const refused = vi.fn()
    await leaveCurrentPage({ tryAdvance: () => false }, 'next', refused)
    expect(refused).not.toHaveBeenCalled()

    const allowed = vi.fn()
    await leaveCurrentPage({ tryAdvance: () => true }, 'next', allowed)
    expect(allowed).toHaveBeenCalledOnce()
  })

  it('🛑 honours a REFUSAL that arrives as a promise', async () => {
    // `tryAdvance` may return a promise, so an un-awaited `if (handle.tryAdvance(...))` is
    // unconditionally true and every refusal passes - including the unbalanced opening trial
    // balance, the one page in this wizard where walking past it is unrecoverable.
    const advance = vi.fn()
    await leaveCurrentPage(asyncHandle(false), 'next', advance)
    expect(advance).not.toHaveBeenCalled()
  })

  it('🛑 advances only AFTER the page has finished saving', async () => {
    // F7: the finalize page reads `ledgerOpening.get`, which has no optimistic update, so
    // advancing before the save landed made it report "No opening trial balance entered" about
    // the entry that had just been saved.
    const log: string[] = []
    await leaveCurrentPage(asyncHandle(true, log), 'next', () => log.push('advanced'))
    expect(log).toEqual(['saved', 'advanced'])
  })
})
