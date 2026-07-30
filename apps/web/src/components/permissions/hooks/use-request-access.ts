// apps/web/src/components/permissions/hooks/use-request-access.ts
// Types only for now — no `'use client'`, so a server component can import the
// contract without pulling a client boundary in. The record lane's hook lands
// here and brings the directive with it.

/**
 * One approver, as the preflight names them.
 *
 * Naming who decides is the difference between "sent into the void" and "Sarah
 * will see this", so every lane's preflight resolves this SERVER-side — the
 * client never reconstructs who holds authority over the target.
 */
export interface RequestAccessApprover {
  userId: string
  name: string | null
  image: string | null
}

/**
 * The domain-free half of a "request access to this thing" hook — and therefore
 * the prop contract of `components/permissions/ui/request-access-popover.tsx`
 * (plan v3 04 §8.1).
 *
 * It lives here rather than beside either hook because it is the seam between
 * them: `mail-permissions/hooks/use-request-access.ts` returns this plus its
 * mail-only fields (`canShare`, `myLens`, `approversAre`), and the record lane's
 * hook will land in this file returning this plus its own. The shell only ever
 * sees what is listed below, which is what stops mail vocabulary leaking into it.
 *
 * ⚠ Everything here is **presentation only**. Each lane's server procedure
 * repeats every eligibility check independently — that is where a direct API
 * caller meets them.
 */
export interface RequestAccessState {
  /** Render the trigger at all: below the ceiling, and unable to just self-grant. */
  eligible: boolean
  /** Server-authoritative `false` — the ask would be refused, and why, in words. */
  refusalCopy: string | null
  /** An existing pending request of theirs, which swaps the trigger for a status view. */
  pending: { id: string; createdAt: Date } | null
  /** Who will decide it, named. */
  approvers: RequestAccessApprover[]
  /** Server-composed header label; degrades safely when the viewer cannot read the target. */
  subjectLabel: string | null
  isLoading: boolean
  send: (message?: string) => void
  withdraw: () => void
  isSending: boolean
  isWithdrawing: boolean
}
