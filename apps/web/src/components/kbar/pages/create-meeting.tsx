// apps/web/src/components/kbar/pages/create-meeting.tsx
'use client'

import { MeetingForm } from '~/components/calls/ui/meeting-form'
import { useCommandPaletteStore } from '../store'

/**
 * Hosts the shell-free {@link MeetingForm} as a palette page (create mode only).
 * The breadcrumb supplies the title (no header slot). On success / cancel the
 * palette closes; back returns to root.
 */
export function CreateMeetingPage() {
  const page = useCommandPaletteStore((s) => s.page)
  const close = useCommandPaletteStore((s) => s.close)
  const goTo = useCommandPaletteStore((s) => s.goTo)

  return (
    <div className='p-4 max-sm:flex max-sm:min-h-0 max-sm:flex-1 max-sm:flex-col max-sm:overflow-y-auto'>
      <MeetingForm
        open={page === 'create-meeting'}
        onSuccess={close}
        onClose={close}
        onCancel={() => goTo('root')}
      />
    </div>
  )
}
