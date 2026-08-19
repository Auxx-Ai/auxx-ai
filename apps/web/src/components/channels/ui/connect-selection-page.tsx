// apps/web/src/components/channels/ui/connect-selection-page.tsx
'use client'

import { CONNECTION_SETTLED_EVENT, type ConnectionSettledEvent } from '@auxx/lib/connections/client'
import { rooms } from '@auxx/lib/realtime/client'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getIntegrationProviderIcon } from '~/components/channels/ui/channel-icon'
import type { GalleryExtraPage } from '~/components/templates/ui'
import { useUser } from '~/hooks/use-user'
import { useRealtimeRoom } from '~/realtime/hooks'
import { api } from '~/trpc/react'

/**
 * The step that finishes a connect the OAuth callback could not finish on its own.
 *
 * ## Why it exists
 *
 * A Facebook grant reaches EVERY Page the connecting user administers, and only one of them
 * becomes the channel. Provisioning used to take `pages[0]` — Graph documents no ordering — so a
 * business running several Pages got an arbitrary one, silently. The post-connect hook now parks
 * a marker and provisions nothing; this collects the answer.
 *
 * It runs on every fresh connect, including a grant that reached exactly one Page, where it is a
 * confirmation rather than a choice. That is on purpose: Meta's app review has to SEE what
 * `pages_show_list` is used for, and a connect that auto-selects demonstrates nothing.
 *
 * ## Why it is a PAGE of the connect dialog, and not a dialog of its own
 *
 * It used to be a second dialog that opened on its own once a server query noticed a parked
 * marker. That put the picker's appearance at the mercy of a signal race: the gallery closed on
 * the popup's settle, and the picker opened on a later query — so every dropped or mistimed
 * signal showed the user a connect that had simply vanished. Three separate client-side patches
 * tried to answer "did the hook land yet?" and the last one answered it with a `staleTime`-gated
 * `fetch`, which served a cached `null` for thirty seconds.
 *
 * Nothing opens this step now: **clicking Connect does**. The dialog stays put and moves to this
 * page immediately, in a waiting state, with the OAuth popup on top of it. Signals only ever
 * FILL IT IN, so a slow, dropped, or duplicated one costs latency and nothing else.
 *
 * ## The signals, in order of speed
 *
 *  1. `connection:settled` on the user's realtime room — published the instant the hook resolves,
 *     addressed to the user rather than to a window, so it survives everything that can happen to
 *     the popup. This is the fast path and the reason there is no waiting in the normal case.
 *  2. A poll of `channel.pendingConnectSelection`, running ONLY while this page is waiting.
 *     Realtime is a no-op when Pusher is unconfigured, so the push can never be the only answer.
 *  3. {@link WAIT_TIMEOUT_MS}, the floor — a connect whose signals were all lost says so instead
 *     of spinning forever.
 *
 * The query stays the authority throughout: the realtime event carries no options, only the fact
 * that there are some. That keeps the permission check (`channelsManage`) on the read path.
 *
 * ## Generic on purpose
 *
 * It knows no Meta nouns. The router maps Pages to `{ id, label, sublabel, selectable,
 * disabledReason }` before they get here, so a second selection kind is a `COPY` entry and a
 * submit arm — not a second component. See plans/channels/facebook-page-picker.md §11.
 */

type SelectionKind = 'social-page-selection'

/** Per-kind copy. The one place a new selection kind adds a line. */
const COPY: Record<
  SelectionKind,
  { crumb: string; title: string; description: string; submit: string; waiting: string }
> = {
  'social-page-selection': {
    crumb: 'Choose a Page',
    title: 'Choose a Page',
    // Phrased for one Page as much as for ten: the picker runs on every fresh connect, because
    // showing which Pages the grant reached is what justifies `pages_show_list` to Meta's app
    // review. "…manages more than one Page" would read as a bug on a single-Page account.
    description:
      'Pick the Facebook Page this channel should send and receive messages for. Only the Page you choose is connected.',
    submit: 'Connect Page',
    waiting: 'Reading the Pages this account manages…',
  },
}

/** Copy for the waiting step, before the server has said which kind of choice is coming. */
const UNKNOWN_KIND_COPY = COPY['social-page-selection']

/** Above this many options a flat radio list stops being scannable. */
const FILTER_THRESHOLD = 10

/** Fallback poll while waiting, for when realtime is unconfigured or the socket is down. */
const POLL_INTERVAL_MS = 1500

/**
 * How long to wait for ANY signal before telling the user we lost the connect.
 *
 * Generous on purpose: the hook does three sequential Graph round trips before it can park
 * anything (and up to one probe per Page on Instagram), so "slow" and "dead" genuinely look the
 * same for several seconds. The marker survives on the server either way — this only decides when
 * to stop showing a spinner.
 */
const WAIT_TIMEOUT_MS = 90_000

export interface UseConnectSelectionArgs {
  /**
   * May this host finish a parked connect at all? False for the personal-inbox gallery and for
   * members without `channels.manage` — `pendingConnectSelection` 403s for them, and a personal
   * connect never parks anything.
   */
  enabled: boolean
  /**
   * Also look for a connect parked BEFORE this dialog opened — a reload mid-pick, a popup that
   * was blocked into a full-page redirect, a tab that was closed. Set by the hosts that are the
   * landing surface for those; the picker then opens itself.
   */
  resume: boolean
  /** The hook resolved, whatever the outcome. The host clears any popup-flow busy state. */
  onSettled: () => void
  /** A channel now exists — picked here, or provisioned without needing a choice. */
  onFinished: () => void
}

export interface UseConnectSelection {
  /** Non-null while the picker owns the dialog body. Hand straight to `extraPage`. */
  extraPage: GalleryExtraPage | null
  /** Enter the waiting step. Call when a two-phase connect kicks off, not when it lands. */
  begin: () => void
  /**
   * Leave the step without answering. The host calls this when its dialog closes while
   * {@link extraPage} is showing — the shell's Cancel is a host-level close, not ours.
   *
   * Deliberately does NOT clear the server marker: leaving it is what makes "finish later" work.
   * The credential id is remembered locally instead, so the resume path doesn't immediately
   * re-open the step the user just dismissed.
   */
  dismiss: () => void
}

export function useConnectSelection({
  enabled,
  resume,
  onSettled,
  onFinished,
}: UseConnectSelectionArgs): UseConnectSelection {
  const utils = api.useUtils()
  const { userId } = useUser()

  /** True from the moment a two-phase connect starts until this step is left. */
  const [active, setActive] = useState(false)
  const [selected, setSelected] = useState('')
  const [filter, setFilter] = useState('')
  const [timedOut, setTimedOut] = useState(false)
  /** Set from a failed `connection:settled` — the hook threw and there will be no options. */
  const [failure, setFailure] = useState<string | null>(null)
  /**
   * Credential ids this step will not answer, for two reasons that want the same list.
   *
   * **Dismissed.** Cancel deliberately leaves the marker on the credential — that is what makes
   * "finish later" work, and the short-lived token beside it expires on its own within the hour.
   * Without this the resume path would immediately re-open the step the user just closed.
   *
   * **Superseded.** A marker parked by an EARLIER abandoned connect is still on the server when a
   * new one starts, and `deleteSupersededPendingCredentials` only clears it once the new hook
   * gets that far. Since the step now opens on click rather than on an answer, that stale marker
   * would otherwise be the first thing it renders — offering the Pages of the previous grant, for
   * the connect the user just started. `begin` retires it up front. A fresh connect always mints
   * a new credential (`saveConnection` with no `connectionId` INSERTs), so the incoming marker
   * can never collide with a retired id.
   */
  const [ignored, setIgnored] = useState<string[]>([])

  const pending = api.channel.pendingConnectSelection.useQuery(undefined, {
    enabled: enabled && (active || resume),
    // The picker is the point of the flow, not a background nicety — a stale cached `null` right
    // after the connect starts is exactly the case this must not serve.
    staleTime: 0,
    // Runs only while this step is on screen with no answer yet, and stops the moment one lands.
    // Never a background poll. `ignored` is applied here too — a retired marker is not an answer,
    // and treating it as one would stop the poll before the real one has been written.
    refetchInterval: (query) => {
      const answered = !!query.state.data && !ignored.includes(query.state.data.credentialId)
      return active && !answered && !failure && !timedOut ? POLL_INTERVAL_MS : false
    },
  })

  const data = pending.data && !ignored.includes(pending.data.credentialId) ? pending.data : null
  // Resume takes over the body too: a marker parked by an earlier session is the same step.
  const showing = active || (resume && !!data)
  const waiting = showing && !data && !failure

  const leave = useCallback(() => {
    setActive(false)
    setSelected('')
    setFilter('')
    setFailure(null)
    setTimedOut(false)
  }, [])

  const begin = useCallback(() => {
    // Retire whatever is parked right now — it belongs to a previous connect, not this one.
    const stale = utils.channel.pendingConnectSelection.getData()?.credentialId
    if (stale) setIgnored((prev) => (prev.includes(stale) ? prev : [...prev, stale]))
    setSelected('')
    setFilter('')
    setFailure(null)
    setTimedOut(false)
    setActive(true)
  }, [utils])

  const dismiss = useCallback(() => {
    if (data) setIgnored((prev) => [...prev, data.credentialId])
    leave()
  }, [data, leave])

  const selectSocialPage = api.channel.selectSocialPage.useMutation({
    onSuccess: async () => {
      leave()
      await Promise.all([
        utils.channel.pendingConnectSelection.invalidate(),
        utils.channel.list.invalidate(),
        utils.inbox.settingsList.invalidate(),
        utils.record.listAll.invalidate(),
      ])
      onFinished()
    },
    onError: (error) =>
      toastError({ title: 'Could not connect this Page', description: error.message }),
  })

  /**
   * The fast path (signal 1). The event carries no options — it says the hook resolved and what
   * it resolved to, and the query is re-read for the rest. A `connection:settled` for a connect
   * that provisioned normally finishes the whole flow from here, so the waiting step is
   * transient rather than a dead end.
   */
  const onRealtime = useCallback(
    (event: string, payload: unknown) => {
      if (event !== CONNECTION_SETTLED_EVENT) return
      const settled = payload as ConnectionSettledEvent
      onSettled()
      if (!settled.ok) {
        setFailure(settled.error ?? 'The connection could not be completed.')
        return
      }
      if (settled.awaiting) {
        void utils.channel.pendingConnectSelection.invalidate()
        return
      }
      // Provisioned outright (no choice was needed) — nothing to pick.
      leave()
      onFinished()
    },
    [onSettled, onFinished, leave, utils]
  )

  useRealtimeRoom(enabled && userId ? rooms.user(userId) : null, { onEvent: onRealtime })

  // Signal 3: the floor. Reset per waiting spell, so a second connect gets a full window.
  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => setTimedOut(true), WAIT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [waiting])

  // A different pending connect is a different question — never carry the previous pick into it.
  useEffect(() => {
    setSelected('')
    setFilter('')
  }, [data?.credentialId])

  const options = useMemo(() => data?.options ?? [], [data])
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return options
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        (option.sublabel ?? '').toLowerCase().includes(needle)
    )
  }, [options, filter])

  if (!showing) return { extraPage: null, begin, dismiss }

  const copy = (data && COPY[data.kind as SelectionKind]) ?? UNKNOWN_KIND_COPY

  async function submit() {
    if (!data || !selected) return
    try {
      await selectSocialPage.mutateAsync({ credentialId: data.credentialId, pageId: selected })
    } catch {
      // Toasted in `onError`; the step stays open so the user can pick again.
    }
  }

  const selectable = options.filter((option) => option.selectable)
  const noneSelectable = options.length > 0 && selectable.length === 0

  return {
    begin,
    dismiss,
    extraPage: {
      crumb: copy.crumb,
      size: 'md',
      // No Back: the OAuth hop already happened, so the connect form behind this page describes a
      // decision that has been made. Cancel is the only way out, and it leaves the marker.
      onBack: undefined,
      footer: data ? (
        <Button
          variant='outline'
          size='sm'
          onClick={() => void submit()}
          disabled={!selected || selectSocialPage.isPending}
          loading={selectSocialPage.isPending}
          loadingText='Connecting…'
          data-dialog-submit>
          {copy.submit} <KbdSubmit variant='outline' size='sm' />
        </Button>
      ) : null,
      render: () => (
        <div className='flex flex-col gap-3 p-3'>
          <div className='flex flex-col gap-1'>
            <h2 className='font-medium text-sm'>{copy.title}</h2>
            <p className='text-muted-foreground text-xs'>
              {failure ?? (waiting ? copy.waiting : copy.description)}
            </p>
          </div>

          {failure ? null : waiting ? (
            timedOut ? (
              <p className='text-muted-foreground text-xs'>
                We haven't heard back from this connect. It may still finish — reopen this dialog
                from the channels page in a moment, or start it again.
              </p>
            ) : (
              <div className='flex flex-col gap-2'>
                <Skeleton className='h-14 w-full rounded-2xl' />
                <Skeleton className='h-14 w-full rounded-2xl' />
              </div>
            )
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
                    icon={getIntegrationProviderIcon(data?.providerKey ?? '', 'size-4')}
                    label={option.label}
                    // `sublabel` renders in parentheses beside the label, `description` on the
                    // line below. Both were being crammed into `sublabel`, which left every card
                    // with an empty description row under it.
                    sublabel={option.sublabel ?? undefined}
                    description={option.description ?? undefined}
                    disabled={!option.selectable || selectSocialPage.isPending}
                    className={option.selectable ? undefined : 'opacity-60'}
                  />
                ))}
              </RadioGroup>
              {noneSelectable && (
                // Otherwise every card is disabled and the submit never enables, with nothing
                // saying why.
                <p className='text-muted-foreground text-xs'>
                  None of these can be connected right now. They are either already connected in
                  this organization, or missing a linked Instagram Professional account.
                </p>
              )}
              {visible.length === 0 && !noneSelectable && (
                <p className='text-muted-foreground text-xs'>Nothing matches that filter.</p>
              )}
            </div>
          )}
        </div>
      ),
    },
  }
}
