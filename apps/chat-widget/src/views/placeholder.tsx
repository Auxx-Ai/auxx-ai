// apps/chat-widget/src/views/placeholder.tsx
//
// Remaining stub frame views. Phase 6 replaces MessagesView + ThreadView.

import { useNavStack } from '~/navigation/nav-stack-context'
import { Button } from '~/ui/button'

function StubBody({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[color:var(--color-muted)]'>
      <span className='text-sm font-medium text-[color:var(--color-fg)]'>{label}</span>
      {hint ? <span className='text-xs'>{hint}</span> : null}
    </div>
  )
}

export function MessagesView() {
  const nav = useNavStack()
  return (
    <div className='flex flex-1 flex-col gap-4 p-5'>
      <p className='text-sm text-[color:var(--color-muted)]'>
        Messages placeholder — Phase 6 fills this in.
      </p>
      <Button
        size='sm'
        variant='outline'
        onClick={() => nav.push({ id: 'demo', label: 'Demo thread', view: 'thread' })}>
        Open thread (test deep frame)
      </Button>
    </div>
  )
}

export function ThreadView({ label }: { label: string }) {
  return <StubBody label={label} hint='Thread view — Phase 6 fills this in.' />
}
