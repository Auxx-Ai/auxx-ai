// apps/web/src/components/calls/ui/recording-insights.tsx
'use client'

import type { RecordingInsightEntity } from '@auxx/database'
import type { SelectOption } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { AlertCircle, ChevronDown, RefreshCw, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { api } from '~/trpc/react'
import { CreateInsightTemplateDialog } from './create-insight-template-dialog'

type InsightSection = {
  templateSectionId?: string
  title?: string
  type?: 'plaintext' | 'list'
  values?: string[]
}

export function RecordingInsights({ recordingId }: { recordingId: string }) {
  const [createOpen, setCreateOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const utils = api.useUtils()

  const { data: templates } = api.recording.insightTemplates.list.useQuery({
    status: 'enabled',
  })

  const { data: insights } = api.recording.insights.list.useQuery(
    { recordingId },
    {
      refetchInterval: (query) => {
        const rows = (query.state.data as RecordingInsightEntity[] | undefined) ?? []
        return rows.some((r) => r.status === 'processing') ? 3000 : false
      },
    }
  )

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(undefined)

  const effectiveTemplateId = useMemo(() => {
    if (selectedTemplateId) return selectedTemplateId
    if (insights && insights.length > 0) return insights[0]!.insightTemplateId
    return templates?.find((t) => t.isDefault)?.id ?? templates?.[0]?.id
  }, [selectedTemplateId, insights, templates])

  const activeInsight = useMemo(
    () => insights?.find((i) => i.insightTemplateId === effectiveTemplateId),
    [insights, effectiveTemplateId]
  )

  const generate = api.recording.insights.generate.useMutation({
    onSuccess: () => {
      utils.recording.insights.list.invalidate({ recordingId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to generate insight', description: error.message })
    },
  })

  const templateOptions: SelectOption[] = useMemo(
    () => (templates ?? []).map((t) => ({ value: t.id, label: t.title })),
    [templates]
  )

  const activeTemplateLabel = useMemo(() => {
    if (!effectiveTemplateId) return 'Select template'
    return templates?.find((t) => t.id === effectiveTemplateId)?.title ?? 'Select template'
  }, [effectiveTemplateId, templates])

  return (
    <>
      <Section
        title='Insights'
        icon={<Sparkles className='size-3.5' />}
        collapsible={false}
        actions={
          <div className='flex items-center gap-1'>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant='ghost' size='sm' className='min-w-[160px] justify-between gap-1'>
                  <span className='truncate'>{activeTemplateLabel}</span>
                  <ChevronDown className='size-3 shrink-0' />
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-64 p-0' align='end'>
                <MultiSelectPicker
                  options={templateOptions}
                  value={effectiveTemplateId ? [effectiveTemplateId] : []}
                  onChange={() => {}}
                  multi={false}
                  onSelectSingle={(value) => {
                    setSelectedTemplateId(value)
                    setPickerOpen(false)
                  }}
                  canManage={false}
                  canAdd={false}
                  placeholder='Search templates...'
                  onCreate={() => {
                    setPickerOpen(false)
                    setCreateOpen(true)
                  }}
                  createLabel='New template'
                />
              </PopoverContent>
            </Popover>
            <Button
              variant='ghost'
              size='icon-sm'
              loading={generate.isPending}
              disabled={!effectiveTemplateId}
              onClick={() => {
                if (!effectiveTemplateId) return
                generate.mutate({ recordingId, templateId: effectiveTemplateId })
              }}>
              <RefreshCw />
            </Button>
          </div>
        }>
        <InsightBody insight={activeInsight} />
      </Section>

      {createOpen && (
        <CreateInsightTemplateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(templateId) => {
            setSelectedTemplateId(templateId)
            generate.mutate({ recordingId, templateId })
          }}
        />
      )}
    </>
  )
}

function InsightBody({ insight }: { insight?: RecordingInsightEntity }) {
  if (!insight) {
    return (
      <p className='py-6 text-center text-sm text-muted-foreground'>
        Select a template and hit refresh to generate insights.
      </p>
    )
  }

  if (insight.status === 'processing') {
    return (
      <div className='space-y-3 py-4'>
        <Skeleton className='h-4 w-1/3' />
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-4 w-5/6' />
        <p className='pt-2 text-xs text-muted-foreground'>Generating insight...</p>
      </div>
    )
  }

  if (insight.status === 'failed') {
    return (
      <div className='my-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm'>
        <div className='flex items-center gap-2 font-medium text-destructive'>
          <AlertCircle className='size-4' />
          Insight generation failed
        </div>
        <p className='mt-1 text-muted-foreground'>
          Try regenerating. If it keeps failing, the template may need tighter prompts.
        </p>
      </div>
    )
  }

  const sections = (insight.sections as InsightSection[] | null) ?? []
  if (sections.length === 0) {
    return <p className='py-6 text-center text-sm text-muted-foreground'>No sections generated.</p>
  }

  return (
    <div className='space-y-4 py-2'>
      {sections.map((section, idx) => {
        const values = (section.values ?? []).filter((v) => v.trim().length > 0)
        const isEmpty = values.length === 0
        return (
          <div key={section.templateSectionId ?? idx}>
            <h4 className='text-sm font-semibold'>{section.title}</h4>
            {isEmpty ? (
              <p className='mt-1 text-sm italic text-muted-foreground/70'>Not discussed</p>
            ) : section.type === 'list' ? (
              <ul className='mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground'>
                {values.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            ) : (
              <p className='mt-1 whitespace-pre-wrap text-sm text-muted-foreground'>
                {values.join(' ')}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
