// apps/web/src/components/schedule/ui/visit-close-chooser.tsx
//
// The "Complete…" bottom sheet (08-worker-surface.md §1/§3): three close options — invoice now,
// invoice later, leave open — a confirmation-only "Invoice drafted ✓" state (the worker never
// sees amounts, `closeMyVisit` never returns them), and a soft no-contact notice for the
// defensive race where "now" somehow fires with no contact. WS2 adds a soft required-checks
// warning line (08-worker-surface.md §5) — it WARNS ONLY and never disables an option.

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHandle,
  DrawerTitle,
} from '@auxx/ui/components/drawer'
import { toastError } from '@auxx/ui/components/toast'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from '~/trpc/react'

type CloseInvoiceOption = 'now' | 'later' | 'leave_open'
type CloseResult = { invoiced: boolean; invoiceError?: 'no_contact' }

interface VisitCloseChooserProps {
  visitId: string
  /** Disables "Close job & invoice" when the job has no customer yet (08 §3). */
  hasContact: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Bottom-sheet positioning override — `DrawerContent`'s base classes assume a right-side
 * panel (`packages/ui/src/components/drawer.tsx`); `direction='bottom'` only changes the Vaul
 * drag/swipe behavior, not this className, so the bottom-sheet placement is applied here. */
const BOTTOM_SHEET_CLASS =
  'inset-x-0 bottom-0 top-auto right-auto left-0 max-h-[85vh] w-full rounded-t-2xl border-t max-sm:w-screen!'

/**
 * The close chooser drawer — opened by `VisitStatusButton` on "Complete…". After any successful
 * close it navigates back to `/app/schedule`; the `'now'` + invoiced path shows a confirmation
 * screen with a "Done" button first instead of navigating immediately.
 */
export function VisitCloseChooser({
  visitId,
  hasContact,
  open,
  onOpenChange,
}: VisitCloseChooserProps) {
  const router = useRouter()
  const [result, setResult] = useState<CloseResult | null>(null)

  // Same list the Notes tab reads — only fetched while the sheet is open (08 §5).
  const { data: qcData } = api.dispatch.listMyVisitQcItems.useQuery({ visitId }, { enabled: open })
  const requiredOpen =
    qcData?.items.filter((item) => item.isRequired && !item.checkedAt).length ?? 0

  const closeVisit = api.dispatch.closeMyVisit.useMutation({
    onError: (error) => toastError({ title: 'Error closing visit', description: error.message }),
  })

  const handleClose = (invoice: CloseInvoiceOption) => {
    closeVisit.mutate(
      { visitId, invoice },
      {
        onSuccess: (data) => {
          if (invoice === 'now') {
            setResult(data)
            return
          }
          onOpenChange(false)
          router.push('/app/schedule')
        },
      }
    )
  }

  const handleDone = () => {
    setResult(null)
    onOpenChange(false)
    router.push('/app/schedule')
  }

  return (
    <Drawer
      direction='bottom'
      open={open}
      onOpenChange={(next) => {
        if (!next) setResult(null)
        onOpenChange(next)
      }}>
      <DrawerContent className={BOTTOM_SHEET_CLASS}>
        <DrawerHandle />
        {result ? (
          <div className='flex flex-col items-center gap-3 p-6 text-center'>
            <CheckCircle2 className='size-10 text-success-500' />
            {result.invoiced ? (
              <>
                <DrawerTitle>Invoice drafted ✓</DrawerTitle>
                <DrawerDescription>Office will review and send it.</DrawerDescription>
              </>
            ) : (
              <>
                <DrawerTitle>Job closed</DrawerTitle>
                <DrawerDescription>
                  {result.invoiceError === 'no_contact'
                    ? "Couldn't draft an invoice — this job still needs a customer."
                    : 'No invoice was created.'}
                </DrawerDescription>
              </>
            )}
            <Button onClick={handleDone} className='mt-2 w-full'>
              Done
            </Button>
          </div>
        ) : (
          <>
            <DrawerTitle className='px-4 pt-4'>Complete this visit</DrawerTitle>
            <DrawerDescription className='px-4'>Choose how to close this job.</DrawerDescription>
            {requiredOpen > 0 && (
              <div className='mx-4 flex items-center gap-2 rounded-md bg-amber-400/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400'>
                <TriangleAlert className='size-4 shrink-0' />
                <span>
                  {requiredOpen} required {requiredOpen === 1 ? 'check' : 'checks'} open
                </span>
              </div>
            )}
            <div className='flex flex-col gap-2 p-4'>
              <Button
                variant='outline'
                className='h-auto flex-col items-start gap-0.5 whitespace-normal py-3'
                disabled={!hasContact || closeVisit.isPending}
                loading={closeVisit.isPending && closeVisit.variables?.invoice === 'now'}
                loadingText='Closing…'
                onClick={() => handleClose('now')}>
                <span>Close job & invoice</span>
                {!hasContact && (
                  <span className='text-xs font-normal text-muted-foreground'>
                    Needs a customer on the job
                  </span>
                )}
              </Button>
              <Button
                variant='outline'
                disabled={closeVisit.isPending}
                loading={closeVisit.isPending && closeVisit.variables?.invoice === 'later'}
                loadingText='Closing…'
                onClick={() => handleClose('later')}>
                Close, invoice later
              </Button>
              <Button
                variant='ghost'
                disabled={closeVisit.isPending}
                loading={closeVisit.isPending && closeVisit.variables?.invoice === 'leave_open'}
                loadingText='Closing…'
                onClick={() => handleClose('leave_open')}>
                Leave job open
              </Button>
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}
