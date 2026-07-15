// apps/web/src/components/dispatch/ui/client-notifications-settings-page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Alert } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { Bell, Lock, Mail, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEmailChannels } from '~/components/channels/store/channel-store'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api, type RouterOutputs } from '~/trpc/react'

const BREADCRUMBS = [{ title: 'Dispatch Settings' }, { title: 'Client notifications' }]

type TemplateRow = RouterOutputs['sequence']['listTemplates'][number]
type TemplateStep = TemplateRow['steps'][number]

/** `'HH:MM'` → `'9:00 AM'`. */
function formatTimeOfDay(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return hhmm
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** One step's timing as a short human phrase — joined with " · " for the row's summary. */
function stepTimingPhrase(step: TemplateStep): string {
  if (step.timingMode === 'anchor') {
    const days = step.anchorOffsetDays
    const when =
      days === 0
        ? 'Same day'
        : `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ${days < 0 ? 'before' : 'after'}`
    return step.anchorTimeOfDay ? `${when} at ${formatTimeOfDay(step.anchorTimeOfDay)}` : when
  }
  if (step.delayDays === 0 && step.delayHours === 0) return 'Immediately'
  const parts: string[] = []
  if (step.delayDays > 0) parts.push(`${step.delayDays} ${step.delayDays === 1 ? 'day' : 'days'}`)
  if (step.delayHours > 0)
    parts.push(`${step.delayHours} ${step.delayHours === 1 ? 'hour' : 'hours'}`)
  return `${parts.join(' ')} later`
}

function summarizeTiming(steps: TemplateStep[]): string {
  if (steps.length === 0) return 'No steps yet'
  return steps.map(stepTimingPhrase).join(' · ')
}

/**
 * "Client notifications" settings page (client-notifications plan §4.7) — one row per seeded
 * sequence (`templateKey` non-null), each an enable switch + timing summary + "Edit template"
 * link into the real sequence editor. This is glue over the sequences engine, not a new
 * notification system (decision #6/#1).
 */
export function ClientNotificationsSettingsPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const { hasAccess } = useFeatureFlags()

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <SettingsPage
        title='Client notifications'
        description='Automated emails to customers around visits, jobs, and invoices.'
        breadcrumbs={BREADCRUMBS}>
        <EmptyState
          icon={Lock}
          title='Dispatch Not Available'
          description='Upgrade your plan to use quoting and dispatch.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  return <ClientNotificationsSettingsBody />
}

function ClientNotificationsSettingsBody() {
  const { data: templates, isLoading } = api.sequence.listTemplates.useQuery()
  // Example integrations are seeded placeholders and can't actually send (channel-picker.tsx).
  const emailChannels = useEmailChannels()
  const hasEmailChannel = emailChannels.some((c) => !c.isExample)

  return (
    <SettingsPage
      title='Client notifications'
      description='Automated emails to customers around visits, jobs, and invoices. Built-in templates start disabled — review the copy, then turn one on.'
      breadcrumbs={BREADCRUMBS}>
      <div className='flex flex-col gap-8 p-3 sm:p-6'>
        <SettingsSection icon={Bell} title='Templates'>
          {!hasEmailChannel && (
            <Alert variant='warning' className='mb-3'>
              <TriangleAlert />
              <div className='flex items-center gap-2'>
                <span className='flex-1'>
                  Connect an email channel before enabling any of these.
                </span>
                <Link href='/app/settings/channels' className='shrink-0 font-medium underline'>
                  Connect a channel
                </Link>
              </div>
            </Alert>
          )}

          {isLoading ? (
            <div className='py-6 text-sm text-muted-foreground'>Loading templates…</div>
          ) : !templates || templates.length === 0 ? (
            <EmptyState
              icon={Mail}
              title='No templates yet'
              description='Client-notification templates are seeded automatically for every org.'
            />
          ) : (
            <div className='flex flex-col'>
              {templates.map(({ sequence, steps }) => (
                <ClientNotificationRow
                  key={sequence.id}
                  sequence={sequence}
                  steps={steps}
                  hasEmailChannel={hasEmailChannel}
                />
              ))}
            </div>
          )}
        </SettingsSection>
      </div>
    </SettingsPage>
  )
}

function ClientNotificationRow({
  sequence,
  steps,
  hasEmailChannel,
}: {
  sequence: TemplateRow['sequence']
  steps: TemplateStep[]
  hasEmailChannel: boolean
}) {
  const router = useRouter()
  const utils = api.useUtils()

  const publish = api.sequence.publish.useMutation({
    onError: (error) =>
      toastError({ title: 'Failed to publish template', description: error.message }),
  })
  const update = api.sequence.update.useMutation({
    onSuccess: () => void utils.sequence.listTemplates.invalidate(),
    onError: (error) =>
      toastError({ title: 'Failed to update template', description: error.message }),
  })

  const isEnabled = sequence.status === 'enabled'
  const missingMailbox = !sequence.integrationId
  const blocked = !hasEmailChannel || missingMailbox
  const isPending = publish.isPending || update.isPending

  const handleToggle = async (checked: boolean) => {
    if (!checked) {
      update.mutate({ id: sequence.id, fields: { status: 'disabled' } })
      return
    }
    // Enable = publish (if there are unpublished changes, or it was never published) + flip
    // status — seeded sequences are compiled+published at seed time, so this is usually a pure
    // status flip; it only republishes when an admin edited the template copy since.
    if (!sequence.publishedAt || sequence.hasUnpublishedChanges) {
      try {
        await publish.mutateAsync({ id: sequence.id })
      } catch {
        return
      }
    }
    update.mutate({ id: sequence.id, fields: { status: 'enabled' } })
  }

  return (
    <div className='flex flex-col border-b py-1.5 last:border-b-0'>
      <TreeRow
        icon={<Mail className='size-4 text-muted-foreground' />}
        title={sequence.name}
        description={summarizeTiming(steps)}
        secondaryFill
        secondary={
          <div className='flex items-center gap-3'>
            <Button
              variant='ghost'
              size='xs'
              onClick={() => router.push(`/app/workflows/sequences/${sequence.id}`)}>
              Edit template
            </Button>
            <Switch
              checked={isEnabled}
              disabled={(blocked && !isEnabled) || isPending}
              onCheckedChange={(checked) => void handleToggle(checked)}
            />
          </div>
        }
      />
      {!isEnabled && blocked && (
        <div className='ps-9 text-xs text-amber-600'>
          {!hasEmailChannel
            ? 'Connect an email channel first.'
            : 'Choose a sending mailbox in the template editor first.'}
        </div>
      )}
    </div>
  )
}
