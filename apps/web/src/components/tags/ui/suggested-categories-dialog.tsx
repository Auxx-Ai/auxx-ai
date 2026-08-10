// apps/web/src/components/tags/ui/suggested-categories-dialog.tsx
//
// The shipped mail categories an org can add, as a one-off picker
// (plans/mail-filter/06-mail-categories-rework-plan.md §7.2, revised 2026-08-10).
//
// ⚠️ THIS REPLACED A PER-PACK TOGGLE, and the reason matters more than the code:
// a group-level switch was a SECOND control over `tag_ai_classify`, which the tag
// list already owns one per tag. Its "off" could never mean anything either —
// turning a pack off never deleted its categories, so they carried on sitting in
// the list below while the switch above claimed the pack was off. Adding is
// one-way; from then on these are ordinary tags, managed where every other tag is.
//
// So this surface only ever answers "what could I add that I do not have", and
// closes. Already-present categories are shown as such and cannot be re-added.

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd } from '@auxx/ui/components/kbd'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'

/**
 * How many eligible labels the classifier reads well.
 *
 * Plan 06 invariant 10 puts the warning at "past ~8"; Q5 puts the revisit-the-shape
 * trigger at ~10. Core 4 + Commerce 2 + Partner 1 = 7, so adding every suggestion
 * stays under budget and only a hand-marked tag can cross it, which is exactly the
 * case that would otherwise degrade classification with nothing on screen to
 * explain why.
 */
export const ELIGIBLE_LABEL_BUDGET = 8

export function SuggestedCategoriesDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const utils = api.useUtils()
  const { data, isPending } = api.tag.suggestedCategories.useQuery(undefined, { enabled: open })
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // A fresh selection each time it opens, so a cancelled pick is not remembered.
  useEffect(() => {
    if (open) setSelected(new Set())
  }, [open])

  const addCategories = api.tag.addSuggestedCategories.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tag.suggestedCategories.invalidate(),
        utils.tag.getAll.invalidate(),
        utils.tag.getHierarchy.invalidate(),
        utils.record.listAll.invalidate(),
      ])
      onOpenChange(false)
    },
    onError: (error) =>
      toastError({ title: 'Error adding categories', description: error.message }),
  })

  const groups = data?.packs ?? []
  const available = groups.flatMap((group) => group.labels).filter((label) => !label.present)
  const nothingLeft = !isPending && available.length === 0

  const toggle = (templateKey: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(templateKey)) next.delete(templateKey)
      else next.add(templateKey)
      return next
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Add suggested categories</DialogTitle>
          <DialogDescription>
            Ready made categories for the AI classifier, with a definition it reads to decide when
            each one fits. You can rename them, rewrite the definition, or switch them off later
            like any other tag.
          </DialogDescription>
        </DialogHeader>

        {data && !data.ready ? (
          <p className='text-muted-foreground text-sm'>
            Mail categories are not set up for this organization yet.
          </p>
        ) : null}

        <div className='max-h-[50vh] space-y-4 overflow-y-auto'>
          {isPending ? (
            <>
              <Skeleton className='h-16 w-full rounded-xl' />
              <Skeleton className='h-16 w-full rounded-xl' />
            </>
          ) : nothingLeft ? (
            <p className='text-muted-foreground text-sm'>
              You already have every suggested category. Manage them in the tag list below.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.pack} className='space-y-2'>
                <div>
                  <p className='font-medium text-sm'>{group.title}</p>
                  <p className='text-muted-foreground text-xs'>{group.summary}</p>
                </div>
                {group.labels.map((label) => (
                  <label
                    key={label.templateKey}
                    className={`flex gap-3 rounded-xl border p-3 ${
                      label.present ? 'opacity-60' : 'cursor-pointer hover:bg-muted/50'
                    }`}>
                    {label.present ? (
                      <Check className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
                    ) : (
                      <Checkbox
                        className='mt-0.5'
                        checked={selected.has(label.templateKey)}
                        onCheckedChange={() => toggle(label.templateKey)}
                      />
                    )}
                    <span className='min-w-0'>
                      <span className='flex items-center gap-1.5 font-medium text-sm'>
                        <span aria-hidden>{label.emoji}</span>
                        {label.title}
                        {label.present ? (
                          <Badge variant='secondary' className='text-xs'>
                            Added
                          </Badge>
                        ) : null}
                      </span>
                      {/* The definition IS the classifier's instruction (plan 05 C3), so it is
                          shown before the choice rather than hidden behind it. */}
                      <span className='mt-0.5 block text-muted-foreground text-xs'>
                        {label.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ))
          )}
        </div>

        {/* The only place the size of the classifier's label set is visible. Plan 06
            invariant 10: growth must be a warning, never a silent accuracy tax. */}
        {data ? (
          <p className='text-muted-foreground text-xs'>
            {data.eligibleLabelCount + selected.size} of about {ELIGIBLE_LABEL_BUDGET} categories
            the AI reads well.
            {data.eligibleLabelCount + selected.size > ELIGIBLE_LABEL_BUDGET
              ? ' Above this, overlapping categories start to compete and the AI applies fewer tags, not more.'
              : ''}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant='ghost' size='sm' onClick={() => onOpenChange(false)}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            size='sm'
            disabled={selected.size === 0 || !data?.ready}
            loading={addCategories.isPending}
            loadingText='Adding...'
            onClick={() => addCategories.mutate({ templateKeys: [...selected] })}>
            {selected.size > 0 ? `Add ${selected.size}` : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
