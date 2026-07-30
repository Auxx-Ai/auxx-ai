// apps/web/src/components/mail-permissions/ui/request-access-popover.tsx
'use client'

import { useState } from 'react'
import { useRequestAccess } from '~/components/mail-permissions/hooks/use-request-access'
import {
  type RequestAccessCopy,
  RequestAccessPopover as Shell,
} from '~/components/permissions/ui/request-access-popover'
import { AccessLevelsGuide } from './access-levels-guide'

const COPY: RequestAccessCopy = {
  trigger: 'Request access',
  pendingTrigger: 'Access requested',
  notePlaceholder: 'Why do you need access?',
}

/** "Sarah Chen (inbox manager)" / "Sarah Chen and 2 others (inbox managers)". */
function approverSummary(
  approvers: Array<{ name: string | null }>,
  approversAre: 'managers' | 'admins' | null
): string | null {
  if (approvers.length === 0) return null
  const first = approvers[0]?.name ?? 'A teammate'
  const noun =
    approversAre === 'admins'
      ? approvers.length > 1
        ? 'administrators'
        : 'administrator'
      : approvers.length > 1
        ? 'inbox managers'
        : 'inbox manager'
  const rest = approvers.length - 1
  return rest > 0 ? `${first} and ${rest} other ${noun}` : `${first} (${noun})`
}

/**
 * Ask for full access to one conversation (plan 42 §6.2).
 *
 * The chrome is `components/permissions/ui/request-access-popover.tsx`, shared
 * with the record lane (plan v3 04 §8.1). What stays here is the mail vocabulary
 * the shell must not know: the "inbox manager"/"administrator" noun, the
 * access-levels guide behind the footer link, and `useRequestAccess({ threadId })`.
 *
 * **Deliberately not a mode of `ThreadSharePopover`.** That popover's body is
 * `MailGranteeList` — other people, immediate persistence, no submit. This has one
 * implicit subject (me), no grantee list, and a submit-and-wait contract with a
 * pending state afterwards. The interaction contracts are opposites and almost
 * nothing in the body is common, so what is shared is the CHROME and the tier
 * vocabulary: the popover shell, the footer guide link, and `AccessLevelsGuide`.
 *
 * There is no lens picker — thread requests are hardcoded `full` (§0.2), which is
 * also what removes the Enterprise refusal case (§5.2). If a picker ever arrives it
 * goes through `LensSelect`, "the one tier picker every mail-permission surface
 * uses", rather than a second select. (The record lane's rung is likewise derived
 * server-side, so the shell has no picker to grow.)
 */
export function RequestAccessPopover({
  threadId,
  variant = 'inline',
}: {
  threadId: string
  /** `inline` sits in the redaction banner; `icon` fills the header's share slot. */
  variant?: 'inline' | 'icon'
}) {
  const [guideOpen, setGuideOpen] = useState(false)

  const {
    eligible,
    refusalCopy,
    pending,
    approvers,
    approversAre,
    subjectLabel,
    send,
    withdraw,
    isSending,
    isWithdrawing,
  } = useRequestAccess({ threadId })

  return (
    <>
      <Shell
        eligible={eligible}
        refusalCopy={refusalCopy}
        pending={pending}
        approvers={approvers}
        approverSummary={approverSummary(approvers, approversAre)}
        subjectLabel={subjectLabel}
        send={send}
        withdraw={withdraw}
        isSending={isSending}
        isWithdrawing={isWithdrawing}
        copy={COPY}
        variant={variant}
        footer={(close) => (
          <button
            type='button'
            className='text-muted-foreground text-xs underline-offset-2 hover:underline'
            onClick={() => {
              close()
              setGuideOpen(true)
            }}>
            Learn about access levels
          </button>
        )}
      />
      {/* Outside the shell on purpose: the footer link closes the popover, and
          `PopoverContent` unmounts its subtree when it does. */}
      <AccessLevelsGuide open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  )
}
