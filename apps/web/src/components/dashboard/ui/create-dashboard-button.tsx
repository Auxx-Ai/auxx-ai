// apps/web/src/components/dashboard/ui/create-dashboard-button.tsx
'use client'

// "New dashboard" button owning its own DashboardFormDialog (create mode). Used
// in the page header and the empty state so both entry points share one wiring.

import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { DashboardFormDialog } from './dashboard-form-dialog'

export function CreateDashboardButton({ size = 'sm' }: { size?: 'sm' | 'default' }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        <Plus />
        New dashboard
      </Button>
      <DashboardFormDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
