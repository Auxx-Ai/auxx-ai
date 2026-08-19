// apps/web/src/components/channels/ui/connect-selection-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { useEffect, useMemo, useState } from 'react'
import { getIntegrationProviderIcon } from '~/components/channels/ui/channel-icon'
import { api } from '~/trpc/react'

/**
 * The picker that finishes a connect the OAuth callback could not finish on its own.
 *
 * ## Why this exists
 *
 * A Facebook grant reaches EVERY Page the connecting user administers, and only one of them
 * becomes the channel. Provisioning used to take `pages[0]` — Graph documents no ordering — so a
 * business running several Pages got an arbitrary one, silently. When the choice is genuinely
 * ambiguous the hook now parks a marker and provisions nothing; this dialog collects the answer.
 *
 * ## Why it self-drives instead of taking props
 *
 * It renders from `channel.pendingConnectSelection`, which is the AUTHORITY. The OAuth popup's
 * `awaiting` flag is only a latency hint — the popup's `verify` poll can settle before the
 * termination page is ever read — so every abandonment path converges on the query instead:
 * popup blocked and redirected, COOP severed the message, the user closed the tab, the page was
 * reloaded mid-pick. Mount this anywhere on the channels surface and all of them resume.
 *
 * ## Generic on purpose
 *
 * It knows no Meta nouns. The router maps Pages to `{ id, label, sublabel, selectable,
 * disabledReason }` before they get here, so a second selection kind is a `COPY` entry and a
 * submit arm — not a second dialog. See plans/channels/facebook-page-picker.md §11.
 */

type SelectionKind = 'social-page-selection'

/** Per-kind copy. The one place a new selection kind adds a line. */
const COPY: Record<SelectionKind, { title: string; description: string; submit: string }> = {
  'social-page-selection': {
    title: 'Choose a Page',
    description:
      'This Facebook account manages more than one Page. Pick the one this channel should send and receive messages for.',
    submit: 'Connect Page',
  },
}

/** Above this many options a flat radio list stops being scannable. */
const FILTER_THRESHOLD = 10

export function ConnectSelectionDialog() {
  const utils = api.useUtils()
  const pending = api.channel.pendingConnectSelection.useQuery(undefined, {
    // The picker is the point of the flow, not a background nicety — a stale cached `null` right
    // after the popup settles is exactly the case this must not miss.
    staleTime: 0,
  })

  const [selected, setSelected] = useState('')
  const [filter, setFilter] = useState('')
  /**
   * Credential ids the user dismissed in THIS session.
   *
   * Cancel deliberately leaves the marker on the credential — that is what makes "reload and
   * finish later" work, and the short-lived token beside it expires on its own within the hour.
   * Without this the query would immediately re-open the dialog the user just closed.
   */
  const [dismissed, setDismissed] = useState<string[]>([])

  const selectSocialPage = api.channel.selectSocialPage.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.channel.pendingConnectSelection.invalidate(),
        utils.channel.list.invalidate(),
        utils.inbox.settingsList.invalidate(),
      ])
    },
    onError: (error) =>
      toastError({ title: 'Could not connect this Page', description: error.message }),
  })

  const data = pending.data ?? null
  const open = !!data && !dismissed.includes(data.credentialId)

  // A different pending connect is a different question — never carry the previous pick into it.
  useEffect(() => {
    setSelected('')
    setFilter('')
  }, [data?.credentialId])

  const options = data?.options ?? []
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return options
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        (option.sublabel ?? '').toLowerCase().includes(needle)
    )
  }, [options, filter])

  if (!data) return null

  const copy = COPY[data.kind as SelectionKind] ?? COPY['social-page-selection']
  const selectable = options.filter((option) => option.selectable)
  const noneSelectable = options.length > 0 && selectable.length === 0

  function dismiss() {
    if (data) setDismissed((prev) => [...prev, data.credentialId])
  }

  async function submit() {
    if (!data || !selected) return
    try {
      await selectSocialPage.mutateAsync({ credentialId: data.credentialId, pageId: selected })
    } catch {
      // Toasted in `onError`; the dialog stays open so the user can pick again.
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss()
      }}>
      <DialogContent position='tc' size='md'>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        {pending.isPending ? (
          <Skeleton className='h-32 w-full rounded-lg' />
        ) : (
          <div className='flex flex-col gap-2'>
            {options.length > FILTER_THRESHOLD && (
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder='Filter…'
                aria-label='Filter the list'
              />
            )}
            <RadioGroup value={selected} onValueChange={setSelected} className='grid gap-2'>
              {visible.map((option) => (
                <RadioGroupItemCard
                  key={option.id}
                  value={option.id}
                  icon={getIntegrationProviderIcon(data.providerKey, 'size-4')}
                  label={option.label}
                  sublabel={option.disabledReason ?? option.sublabel ?? undefined}
                  disabled={!option.selectable || selectSocialPage.isPending}
                  className={option.selectable ? undefined : 'opacity-60'}
                />
              ))}
            </RadioGroup>
            {noneSelectable && (
              // Otherwise every card is disabled and the submit never enables, with nothing
              // saying why.
              <p className='text-xs text-muted-foreground'>
                None of these can be connected right now. They are either already connected in this
                organization, or missing a linked Instagram Professional account.
              </p>
            )}
            {visible.length === 0 && !noneSelectable && (
              <p className='text-xs text-muted-foreground'>Nothing matches that filter.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={dismiss}
            disabled={selectSocialPage.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={submit}
            disabled={!selected || selectSocialPage.isPending}
            loading={selectSocialPage.isPending}
            loadingText='Connecting…'
            data-dialog-submit>
            {copy.submit} <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
