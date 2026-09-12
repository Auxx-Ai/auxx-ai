// apps/web/src/components/money/ui/batch-posting/batch-dialog-parts.tsx
'use client'

// The small pieces every batch dialog repeats: the note card, the loading
// placeholder, the stale-plan wrapper, the field panel's settings and the enum
// row that every one of these screens asks its questions with.
//
// Each of these was duplicated verbatim across `backfill-dialog.tsx` and
// `batch-posting-dialog.tsx`. See `batch-dialog-shell.tsx`'s header for where
// the sharing stops and why.

import { FieldType } from '@auxx/database/enums'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TriangleAlert } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'

/**
 * A sentence the screen keeps.
 *
 * 🛑 A refusal is a card and never a toast (ground rule 9): the book time zone
 * being unset, or a range that runs past the build cutoff, is a task with an
 * address, and a sentence that disappears cannot carry one.
 */
export function BatchDialogNote({ children, tone }: { children: ReactNode; tone?: 'warning' }) {
  return (
    <p
      className={
        tone === 'warning'
          ? 'flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50/60 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/30'
          : 'rounded-md border bg-muted/40 px-3 py-2 text-muted-foreground text-sm'
      }>
      {tone === 'warning' && (
        <TriangleAlert className='mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-500' />
      )}
      <span>{children}</span>
    </p>
  )
}

/** Three rows, while the first preview is in flight and there is nothing to keep. */
export function BatchPlanSkeleton() {
  return (
    <div className='flex flex-col gap-2'>
      <Skeleton className='h-9 w-full' />
      <Skeleton className='h-9 w-full' />
      <Skeleton className='h-9 w-full' />
    </div>
  )
}

/**
 * The plan, dimmed while a refetch is in flight over a kept previous one.
 *
 * Dimmed rather than blanked: this is the screen whose whole point is watching
 * the numbers move, and clearing the table on every change reads as "the
 * numbers just went away".
 */
export function BatchPlanSection({ stale, children }: { stale: boolean; children: ReactNode }) {
  return (
    <div
      className={
        stale
          ? 'flex flex-col gap-4 opacity-60 transition-opacity'
          : 'flex flex-col gap-4 transition-opacity'
      }>
      {children}
    </div>
  )
}

/**
 * The question panel at the top of the preview page.
 *
 * One set of settings so the three dialogs' label columns line up and resize
 * together per screen; `resizeId` is what keeps them independent per dialog.
 */
export function BatchDialogPanel({
  resizeId,
  children,
}: {
  resizeId: string
  children: ReactNode
}) {
  return (
    <FieldPanel
      className='p-0'
      orientation='responsive'
      breakpoint='md'
      resizeId={resizeId}
      defaultLabelWidth={180}>
      {children}
    </FieldPanel>
  )
}

interface BatchEnumRowProps<Value extends string> {
  title: string
  description: string
  options: readonly { value: Value; label: string }[]
  value: Value
  onChange: (value: Value) => void
  /**
   * What a cleared select falls back to.
   *
   * 🛑 Required rather than defaulted: these answers decide what the run writes,
   * so "whatever the first option happens to be" is not a safe guess to make in
   * a shared component.
   */
  fallback: Value
  disabled?: boolean
}

/**
 * One single-select question, generic over the answer.
 *
 * Generic over `Value` rather than typed to a grouping union, because the three
 * dialogs ask four of these between them and only one of the four is a
 * grouping.
 */
export function BatchEnumRow<Value extends string>({
  title,
  description,
  options,
  value,
  onChange,
  fallback,
  disabled,
}: BatchEnumRowProps<Value>) {
  // `FieldOptions.options` is a mutable array of widened `{ value: string }`, so
  // a readonly list of the narrow union cannot be handed over as-is.
  const selectOptions = useMemo(
    () => options.map((option) => ({ value: option.value as string, label: option.label })),
    [options]
  )

  return (
    <FieldPanelRow title={title} type={BaseType.ENUM} showIcon isRequired description={description}>
      <FieldInputAdapter
        fieldType={FieldType.SINGLE_SELECT}
        fieldOptions={{ options: selectOptions }}
        value={value}
        onChange={(next) => onChange(((next as string[])[0] as Value) ?? fallback)}
        disabled={disabled}
      />
    </FieldPanelRow>
  )
}
