// apps/web/src/components/dashboard/ui/dashboard-form-dialog.tsx
'use client'

// Thin modal wrapper around {@link DashboardForm} for both create and edit —
// pass `dashboard` to edit, omit it to create. Supplies the `Dialog` shell and
// header; all form logic lives in the core, which the command palette hosts
// directly as a page.

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { DashboardForm, type EditableDashboard } from './dashboard-form'

export function DashboardFormDialog({
  open,
  onOpenChange,
  dashboard,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present → edit that dashboard; omitted → create a new one. */
  dashboard?: EditableDashboard
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='md' position='tc'>
        {open && (
          <DashboardForm
            dashboard={dashboard}
            onClose={() => onOpenChange(false)}
            header={({ title }) => (
              <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>
                  {dashboard
                    ? 'Update the name, icon, and who can access it.'
                    : 'Give it a name and choose who can see it.'}
                </DialogDescription>
              </DialogHeader>
            )}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
