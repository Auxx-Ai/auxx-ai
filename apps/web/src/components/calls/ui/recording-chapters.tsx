// apps/web/src/components/calls/ui/recording-chapters.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { ListVideo } from 'lucide-react'
import { api } from '~/trpc/react'
import { useRecordingPlayer } from './use-recording-player'

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(totalSeconds / 60)
  const ss = totalSeconds % 60
  return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`
}

export function RecordingChapters({ recordingId }: { recordingId: string }) {
  const { data: chapters } = api.recording.chapters.list.useQuery({ recordingId })
  const seekTo = useRecordingPlayer((s) => s.seekTo)

  if (!chapters || chapters.length === 0) return null

  return (
    <Section title='Chapters' icon={<ListVideo className='size-3.5' />} collapsible={false}>
      <ul className='flex flex-col py-1'>
        {chapters.map((chapter) => (
          <li key={chapter.id}>
            <Button
              variant='ghost'
              className='w-full justify-start gap-3 text-left font-normal'
              onClick={() => seekTo?.(chapter.startMs)}>
              <span className='text-xs tabular-nums text-muted-foreground w-12'>
                {formatTimestamp(chapter.startMs)}
              </span>
              <span>{chapter.title}</span>
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  )
}
