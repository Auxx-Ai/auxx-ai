// apps/web/src/components/mail-suggestions/ui/mail-suggestions-toolbar-button.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Sparkles } from 'lucide-react'
import { useNotificationPanelStore } from '~/components/global/notifications/notification-panel-store'
import { api } from '~/trpc/react'
import { useMailSuggestionsCount } from '../hooks/use-mail-suggestions'

/**
 * The mail toolbar's doorway to the mined suggestions
 * (plans/mail-filter/03-suggestions-plan.md §8.1).
 *
 * **It renders no list of its own.** One surface renders suggestion rows — the
 * notification panel's Approvals tab — and this calls the same `openApprovals()`
 * deep link the kbar and the notification rows already use. Two places drawing
 * the same cards is how the two get different answers.
 *
 * Two hard rules, both of them the feature's own premise applied to its
 * affordance:
 *
 * 1. **Hidden entirely at zero.** An inbox-hygiene feature that adds permanent
 *    chrome to the mail toolbar has failed at its only job.
 * 2. **Never rendered beside `MailFilterRetroactivePrompt`**, which mounts just
 *    below this toolbar. The retroactive prompt wins: it is time-boxed and asks
 *    a question about the mail already on screen, while this is a standing
 *    doorway that will still be here tomorrow.
 */
export function MailSuggestionsToolbarButton() {
  const openApprovals = useNotificationPanelStore((state) => state.openApprovals)
  const { count } = useMailSuggestionsCount()

  // The same cached query the prompt itself reads (`staleTime: 60_000`), so this
  // costs no extra round trip — only the answer to "is that banner showing?".
  const { data: retroactivePrompt } = api.mailFilters.pendingRetroactivePrompt.useQuery(undefined, {
    staleTime: 60_000,
  })

  if (count === 0 || retroactivePrompt) return null

  return (
    <Button
      variant='ghost'
      size='sm'
      className='h-7 shrink-0 gap-1.5 rounded-lg'
      onClick={() => openApprovals()}
      aria-label={`${count} mail suggestion${count === 1 ? '' : 's'}`}>
      <Sparkles />
      <span className='hidden sm:inline'>Suggestions</span>
      <Badge variant='secondary' className='px-1.5'>
        {count}
      </Badge>
    </Button>
  )
}
