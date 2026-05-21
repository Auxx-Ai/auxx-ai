// apps/chat-widget/src/views/placeholder.tsx
//
// Stub frame views. Phase 4 replaces HomeView, Phase 5 replaces the KB views,
// Phase 6 replaces MessagesView + ThreadView. Each renders its label so the
// shell + router can be smoke-tested before real content lands.

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

export function HomeView() {
  const nav = useNavStack()
  return (
    <div className='flex flex-1 flex-col gap-4 p-5'>
      <p className='text-sm text-[color:var(--color-muted)]'>
        Home placeholder — Phase 4 fills this in.
      </p>
      <Button
        size='sm'
        variant='outline'
        onClick={() => nav.push({ id: 'kb-root', label: 'Knowledge base', view: 'kb-section' })}>
        Open KB section (test deep frame)
      </Button>
      <Button
        size='sm'
        variant='outline'
        onClick={() => nav.push({ id: 'demo', label: 'Demo article', view: 'kb-article' })}>
        Open KB article (test deep frame)
      </Button>
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

export function KbSectionView({ label }: { label: string }) {
  return <StubBody label={label} hint='KB section view — Phase 5 fills this in.' />
}

export function KbArticleView({ label }: { label: string }) {
  return <StubBody label={label} hint='KB article view — Phase 5 fills this in.' />
}
