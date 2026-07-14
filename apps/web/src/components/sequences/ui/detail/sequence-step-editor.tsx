// apps/web/src/components/sequences/ui/detail/sequence-step-editor.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Mail, Plus } from 'lucide-react'
import { Fragment } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { useConfirm } from '~/hooks/use-confirm'
import { api, type RouterOutputs } from '~/trpc/react'
import { SequenceDelayPill } from './sequence-delay-pill'
import { SequenceStepCard } from './sequence-step-card'

type SequenceSteps = RouterOutputs['sequence']['get']['steps']

interface SequenceStepEditorProps {
  sequenceId: string
  steps: SequenceSteps
}

/**
 * The Editor tab: a centered single-column linear list of email step cards
 * separated by delay-pill connectors, with up/down reorder (no dnd) and an
 * "Add step" row at the bottom.
 */
export function SequenceStepEditor({ sequenceId, steps }: SequenceStepEditorProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const invalidate = () => utils.sequence.get.invalidate({ id: sequenceId })

  const createStep = api.sequence.createStep.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Failed to add step', description: error.message }),
  })
  const deleteStep = api.sequence.deleteStep.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Failed to delete step', description: error.message }),
  })
  const reorderStep = api.sequence.reorderStep.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Failed to reorder step', description: error.message }),
  })

  /** Swap the step at `index` with its neighbor at `index + direction`. */
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= steps.length) return
    const stepId = steps[index].id
    // Landing slot: between the neighbor pair the step is moving across.
    const previousStepId = direction === -1 ? (steps[target - 1]?.id ?? null) : steps[target].id
    const nextStepId = direction === -1 ? steps[target].id : (steps[target + 1]?.id ?? null)
    reorderStep.mutate({ stepId, sequenceId, previousStepId, nextStepId })
  }

  const handleDelete = async (stepId: string, index: number) => {
    const confirmed = await confirm({
      title: `Delete step ${index + 1}?`,
      description: 'The step and its email content will be permanently removed.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) deleteStep.mutate({ stepId })
  }

  const step1Subject = steps[0]?.subject ?? null
  const lastStepId = steps[steps.length - 1]?.id

  if (steps.length === 0) {
    return (
      <>
        <ConfirmDialog />
        <EmptyState
          icon={Mail}
          title='No steps yet'
          description='Add the first email of this cadence. Later steps reply into its thread.'
          button={
            <Button
              variant='outline'
              loading={createStep.isPending}
              loadingText='Adding…'
              onClick={() => createStep.mutate({ sequenceId })}>
              <Plus />
              Add step
            </Button>
          }
        />
      </>
    )
  }

  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col px-4 py-6'>
      <ConfirmDialog />
      {steps.map((step, index) => (
        <Fragment key={step.id}>
          {index > 0 && (
            <SequenceDelayPill
              sequenceId={sequenceId}
              stepId={step.id}
              delayDays={step.delayDays}
              delayHours={step.delayHours}
            />
          )}
          <SequenceStepCard
            sequenceId={sequenceId}
            step={step}
            index={index}
            totalSteps={steps.length}
            step1Subject={step1Subject}
            onMoveUp={index > 0 ? () => move(index, -1) : undefined}
            onMoveDown={index < steps.length - 1 ? () => move(index, 1) : undefined}
            onDelete={() => void handleDelete(step.id, index)}
          />
        </Fragment>
      ))}

      <div className='flex flex-col items-center'>
        <div className='h-4 w-px bg-border' />
        <Button
          variant='outline'
          size='sm'
          className='border-dashed text-muted-foreground'
          loading={createStep.isPending}
          loadingText='Adding…'
          onClick={() => createStep.mutate({ sequenceId, afterStepId: lastStepId })}>
          <Plus />
          Add step
        </Button>
      </div>
    </div>
  )
}
