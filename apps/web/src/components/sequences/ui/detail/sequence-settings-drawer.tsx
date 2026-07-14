// apps/web/src/components/sequences/ui/detail/sequence-settings-drawer.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Drawer, DrawerContent, DrawerHeader } from '@auxx/ui/components/drawer'
import { Input } from '@auxx/ui/components/input'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import {
  Building2,
  CalendarClock,
  Clock,
  Globe,
  Mail,
  PenLine,
  Power,
  Send,
  Settings,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { ChannelPicker } from '~/components/pickers/channel-picker'
import { TimeZonePicker } from '~/components/pickers/timezone-picker'
import { useSignature } from '~/components/signatures/hooks/use-signature'
import { SignaturePicker } from '~/components/signatures/ui/signature-picker'
import { useConfirm } from '~/hooks/use-confirm'
import { api, type RouterOutputs } from '~/trpc/react'

type Sequence = RouterOutputs['sequence']['get']['sequence']

interface SequenceSettingsDrawerProps {
  sequence: Sequence
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Fields patchable via `sequence.update`. */
type UpdateFields = Parameters<
  ReturnType<typeof api.sequence.update.useMutation>['mutate']
>[0]['fields']

/**
 * Right-side settings drawer: Sending (mailbox + signature), Delivery window
 * (start/end time, timezone, business days), Status (pause/enable), and the
 * Danger zone (delete). Every edit saves immediately via `sequence.update`,
 * optimistically patched into the `sequence.get` cache (no invalidate — the
 * server row reconciles on success, rollback on error).
 */
export function SequenceSettingsDrawer({
  sequence,
  open,
  onOpenChange,
}: SequenceSettingsDrawerProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const update = api.sequence.update.useMutation({
    onMutate: async ({ fields }) => {
      await utils.sequence.get.cancel({ id: sequence.id })
      const previous = utils.sequence.get.getData({ id: sequence.id })
      utils.sequence.get.setData({ id: sequence.id }, (old) =>
        old ? { ...old, sequence: { ...old.sequence, ...fields } } : old
      )
      return { previous }
    },
    // Server truth (e.g. the hasUnpublishedChanges flip) replaces the patch.
    onSuccess: (updated) =>
      utils.sequence.get.setData({ id: sequence.id }, (old) =>
        old ? { ...old, sequence: updated } : old
      ),
    onError: (error, _variables, context) => {
      if (context?.previous) utils.sequence.get.setData({ id: sequence.id }, context.previous)
      toastError({ title: 'Failed to update sequence', description: error.message })
    },
  })
  const save = (fields: UpdateFields) => update.mutate({ id: sequence.id, fields })

  const deleteSequence = api.sequence.delete.useMutation({
    onSuccess: () => {
      onOpenChange(false)
      utils.sequence.list.invalidate()
      router.push('/app/workflows?t=sequences')
    },
    onError: (error) =>
      toastError({ title: 'Failed to delete sequence', description: error.message }),
  })

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete sequence?',
      description:
        'The sequence, its steps, and its run history will be permanently deleted. Active runs must finish or be removed first.',
      confirmText: 'Delete sequence',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) deleteSequence.mutate({ id: sequence.id })
  }

  const { signature } = useSignature(sequence.signatureEntityInstanceId)

  const isEnabled = sequence.status === 'enabled'
  const canEnable = !!sequence.publishedAt

  return (
    <Drawer direction='right' open={open} onOpenChange={onOpenChange} defaultWidth={440}>
      <DrawerContent>
        <ConfirmDialog />
        <DrawerHeader
          icon={<Settings className='size-5 text-muted-foreground' />}
          title='Sequence settings'
          onClose={() => onOpenChange(false)}
        />

        <ScrollArea className='flex-1' scrollbarClassName='w-1.5'>
          <Section
            title='Sending'
            icon={<Send className='size-4' />}
            initialOpen
            collapsible={false}>
            <div className='flex flex-col'>
              <TreeRow
                icon={<Mail className='size-4 text-muted-foreground' />}
                title='Mailbox'
                description='All steps send from this connected email account.'
                secondaryFill
                secondary={
                  <ChannelPicker
                    value={sequence.integrationId ?? ''}
                    onChange={(integrationId) => save({ integrationId })}
                  />
                }
              />
              {!sequence.integrationId && (
                <div className='ps-9 pb-1 text-xs text-amber-600'>
                  Choose a mailbox — publishing requires one.
                </div>
              )}
              <TreeRow
                icon={<PenLine className='size-4 text-muted-foreground' />}
                title='Signature'
                description='Appended to every step. Optional.'
                secondaryFill
                secondary={
                  <SignaturePicker
                    selected={sequence.signatureEntityInstanceId}
                    onChange={(signatureId) => save({ signatureEntityInstanceId: signatureId })}>
                    <Button variant='outline' size='xs'>
                      {signature?.name ?? 'No signature'}
                    </Button>
                  </SignaturePicker>
                }
              />
            </div>
          </Section>

          <Section
            title='Delivery window'
            icon={<CalendarClock className='size-4' />}
            description='Emails only send inside this window; out-of-window sends wait for the next opening.'
            initialOpen
            collapsible={false}>
            <div className='flex flex-col'>
              <TreeRow
                icon={<Clock className='size-4 text-muted-foreground' />}
                title='Start time'
                secondary={
                  <Input
                    type='time'
                    className='h-7 w-28'
                    defaultValue={sequence.deliveryStartTime ?? ''}
                    onBlur={(e) => save({ deliveryStartTime: e.target.value || null })}
                  />
                }
              />
              <TreeRow
                icon={<Clock className='size-4 text-muted-foreground' />}
                title='End time'
                secondary={
                  <Input
                    type='time'
                    className='h-7 w-28'
                    defaultValue={sequence.deliveryEndTime ?? ''}
                    onBlur={(e) => save({ deliveryEndTime: e.target.value || null })}
                  />
                }
              />
              <TreeRow
                icon={<Globe className='size-4 text-muted-foreground' />}
                title='Timezone'
                secondary={
                  <TimeZonePicker
                    selected={sequence.deliveryTimezone ?? undefined}
                    onChange={(tz) => save({ deliveryTimezone: tz || null })}
                    triggerProps={{ size: 'xs' }}
                  />
                }
              />
              <TreeRow
                icon={<Building2 className='size-4 text-muted-foreground' />}
                title='Business days only'
                description='Skip Saturday and Sunday.'
                secondary={
                  <Switch
                    checked={sequence.deliveryBusinessDaysOnly}
                    onCheckedChange={(checked) => save({ deliveryBusinessDaysOnly: checked })}
                  />
                }
              />
            </div>
          </Section>

          <Section
            title='Status'
            icon={<Power className='size-4' />}
            initialOpen
            collapsible={false}>
            <TreeRow
              icon={<Power className='size-4 text-muted-foreground' />}
              title={isEnabled ? 'Enabled' : 'Paused'}
              description='Pausing blocks new enrollments; in-flight runs finish on their own.'
              secondary={
                <Switch
                  checked={isEnabled}
                  onCheckedChange={(checked) => save({ status: checked ? 'enabled' : 'disabled' })}
                  disabled={!isEnabled && !canEnable}
                />
              }
            />
            {!canEnable && (
              <div className='ps-9 text-xs text-muted-foreground'>
                Publish the sequence before enabling it.
              </div>
            )}
          </Section>

          <Section
            title='Danger zone'
            icon={<TriangleAlert className='size-4' />}
            initialOpen
            collapsible={false}>
            <TreeRow
              icon={<Trash2 className='size-4 text-bad-500' />}
              title='Delete sequence'
              description='Removes the sequence, its steps, and its run history.'
              secondary={
                <Button
                  variant='destructive-hover'
                  size='xs'
                  loading={deleteSequence.isPending}
                  loadingText='Deleting…'
                  onClick={() => void handleDelete()}>
                  Delete
                </Button>
              }
            />
          </Section>

          <div className='h-8' />
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  )
}
