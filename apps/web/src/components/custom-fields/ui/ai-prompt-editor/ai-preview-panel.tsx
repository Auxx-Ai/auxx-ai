// apps/web/src/components/custom-fields/ui/ai-prompt-editor/ai-preview-panel.tsx

'use client'

import type { FieldType } from '@auxx/database/types'
import type { AiOptions, RichReferencePrompt } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import { AlertTriangle, Play, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toRecordId, useRecordList } from '~/components/resources'
import { api } from '~/trpc/react'

interface AiPreviewPanelProps {
  /** The field type currently selected in the dialog. */
  type: FieldType
  /** Native options for the selected type (used to populate SELECT enums, etc.). */
  options?: unknown
  /** TipTap prompt JSON the user is editing. */
  prompt: RichReferencePrompt
  /** Field name (used in the LLM system prompt). */
  name?: string
  /** Entity the field lives on — we pick a sample record from this set. */
  entityDefinitionId: string
}

/**
 * Dry-run preview panel embedded in the custom-field dialog's AI section.
 * Picks the first record of the entity type (client already has the list
 * cached for most tables) and runs `customField.previewAi` against it.
 * Results are rendered inline — no writes, no toasts.
 */
export function AiPreviewPanel({
  type,
  options,
  prompt,
  name,
  entityDefinitionId,
}: AiPreviewPanelProps) {
  const { records } = useRecordList({
    entityDefinitionId,
    limit: 5,
    enabled: Boolean(entityDefinitionId),
  })

  const sampleRecordId = useMemo(() => {
    const first = records[0]
    if (!first?.id) return null
    return toRecordId(entityDefinitionId, first.id)
  }, [records, entityDefinitionId])

  const sampleDisplayName = records[0]?.displayName ?? records[0]?.id ?? ''

  const [result, setResult] = useState<{
    resolvedPrompt: string
    value: unknown
    model?: string
    tokens?: { prompt: number; completion: number }
    truncated?: boolean
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const previewMutation = api.customField.previewAi.useMutation({
    onSuccess: (data) => {
      setError(null)
      setResult({
        resolvedPrompt: data.resolvedPrompt,
        value: data.value,
        model: data.model,
        tokens: data.tokens,
        truncated: data.truncated,
      })
    },
    onError: (err) => {
      setResult(null)
      setError(err.message || 'Preview failed')
    },
  })

  const canPreview = Boolean(sampleRecordId) && !previewMutation.isPending

  const runPreview = () => {
    if (!sampleRecordId) return
    previewMutation.mutate({
      type,
      options: options as AiOptions | undefined,
      prompt,
      sampleRecordId,
      name,
    })
  }

  return (
    <div className='space-y-2 rounded-lg border border-dashed border-primary-200/60 px-3 py-2.5'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex min-w-0 flex-col'>
          <span className='text-xs font-medium text-muted-foreground'>Preview</span>
          {sampleDisplayName ? (
            <span className='truncate text-xs text-muted-foreground/70'>
              Sample: {sampleDisplayName}
            </span>
          ) : (
            <span className='text-xs text-muted-foreground/70'>No records to sample from</span>
          )}
        </div>
        <Button
          size='sm'
          type='button'
          variant='outline'
          disabled={!canPreview}
          loading={previewMutation.isPending}
          loadingText='Running…'
          onClick={runPreview}>
          <Play className='size-3' />
          Run
        </Button>
      </div>

      {error && (
        <div className='flex items-start gap-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive'>
          <AlertTriangle className='mt-0.5 size-3 shrink-0' />
          <span className='min-w-0 break-words'>{error}</span>
        </div>
      )}

      {result && (
        <div className='space-y-2 text-xs'>
          <div>
            <div className='mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground'>
              Resolved prompt
            </div>
            <div className='whitespace-pre-wrap rounded-md bg-muted/50 px-2 py-1.5 text-muted-foreground'>
              {result.resolvedPrompt || <em className='opacity-70'>empty</em>}
            </div>
          </div>
          <div>
            <div className='mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground'>
              <Sparkles className='size-3' />
              Result
            </div>
            <div className='whitespace-pre-wrap rounded-md bg-primary/5 px-2 py-1.5'>
              {renderValue(result.value)}
            </div>
          </div>
          <div className='flex gap-3 text-[10px] text-muted-foreground/80'>
            {result.model && <span>{result.model}</span>}
            {result.tokens && (
              <span>
                {result.tokens.prompt} in · {result.tokens.completion} out
              </span>
            )}
            {result.truncated && <span className='text-amber-600'>truncated</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
