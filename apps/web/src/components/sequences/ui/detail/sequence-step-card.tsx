// apps/web/src/components/sequences/ui/detail/sequence-step-card.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { ChevronDown, ChevronUp, Mail, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { AutosaveIndicator } from '~/components/agents/ui/shared/autosave-indicator'
import { Tooltip } from '~/components/global/tooltip'
import type { RouterOutputs } from '~/trpc/react'
import { useSequenceStepAutosave } from '../../hooks/use-sequence-step-autosave'
import { SequenceBodyEditor } from './sequence-body-editor'
import { SequenceStepAttachments } from './sequence-step-attachments'

type SequenceStep = RouterOutputs['sequence']['get']['steps'][number]

interface SequenceStepCardProps {
  sequenceId: string
  step: SequenceStep
  /** 0-based position in the ordered list. */
  index: number
  totalSteps: number
  /** Step 1's subject — steps 2+ thread under it ("Re: …"). */
  step1Subject: string | null
  /** Null for manual sequences — gates the Visit placeholder root (§4.5/§4.7). */
  subjectKind: 'visit' | 'work_order' | 'invoice' | null
  onMoveUp?: () => void
  onMoveDown?: () => void
  onDelete: () => void
}

/**
 * One email step in the Editor tab's linear list: header row (Step N, autosave
 * state, reorder chevrons, delete), the subject input (step 1 only — later
 * steps always reply into step 1's thread, plan §12), the TipTap body editor
 * with the `{` placeholder picker, and the per-step attachment strip.
 */
export function SequenceStepCard({
  sequenceId,
  step,
  index,
  totalSteps,
  step1Subject,
  subjectKind,
  onMoveUp,
  onMoveDown,
  onDelete,
}: SequenceStepCardProps) {
  const autosave = useSequenceStepAutosave({ sequenceId, stepId: step.id })
  // Seed-once local subject/attachments — autosave patches the server without
  // refetching `sequence.get`, so props would otherwise fight local edits.
  const [subject, setSubject] = useState(step.subject ?? '')
  const [attachmentIds, setAttachmentIds] = useState<string[]>(
    () => (step.attachmentIds as string[] | null) ?? []
  )
  const isFirst = index === 0

  return (
    <div className='rounded-xl border bg-primary-50 dark:bg-card shadow-xs'>
      {/* Header */}
      <div className='flex items-center gap-2 border-b px-3 py-2'>
        <Mail className='size-4 text-muted-foreground' />
        <span className='text-sm font-medium'>Step {index + 1}</span>
        <AutosaveIndicator state={autosave.state} />
        <div className='ml-auto flex items-center gap-0.5'>
          <Tooltip content='Move up'>
            <Button variant='ghost' size='icon-xs' disabled={!onMoveUp} onClick={onMoveUp}>
              <ChevronUp />
            </Button>
          </Tooltip>
          <Tooltip content='Move down'>
            <Button variant='ghost' size='icon-xs' disabled={!onMoveDown} onClick={onMoveDown}>
              <ChevronDown />
            </Button>
          </Tooltip>
          <Tooltip
            content={totalSteps === 1 ? 'A sequence needs at least one step' : 'Delete step'}>
            <Button
              variant='destructive-hover'
              size='icon-xs'
              disabled={totalSteps === 1}
              onClick={onDelete}>
              <Trash2 />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className='flex flex-col gap-3 p-3'>
        {/* Subject: only step 1 opens the thread; later steps reply into it. */}
        {isFirst ? (
          <div className='flex items-center gap-2'>
            <span className='shrink-0 text-sm text-muted-foreground'>Subject:</span>
            <Input
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value)
                autosave.schedule({ subject: e.target.value })
              }}
              onBlur={autosave.flush}
              placeholder='Email subject'
              className='h-8'
            />
          </div>
        ) : (
          <div className='text-xs text-muted-foreground'>
            Replies in thread: Re: {step1Subject?.trim() || '(step 1 subject)'}
          </div>
        )}

        <SequenceBodyEditor
          bodyJson={step.bodyJson as Record<string, unknown> | null}
          subjectKind={subjectKind}
          onChange={(bodyJson) =>
            autosave.schedule({ bodyJson: bodyJson as Record<string, unknown> })
          }
          onBlur={autosave.flush}
        />

        <SequenceStepAttachments
          stepId={step.id}
          attachmentIds={attachmentIds}
          onAttachmentIdsChange={(ids) => {
            setAttachmentIds(ids)
            autosave.schedule({ attachmentIds: ids })
            autosave.flush()
          }}
        />
      </div>
    </div>
  )
}
