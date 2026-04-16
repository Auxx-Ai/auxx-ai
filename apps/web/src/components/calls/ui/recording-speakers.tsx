// apps/web/src/components/calls/ui/recording-speakers.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { cn } from '@auxx/ui/lib/utils'
import { Clock, MessageSquare, Users } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const SPEAKER_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-rose-500',
  'bg-cyan-500',
]

interface MockSpeaker {
  id: string
  name: string
  utteranceCount: number
  totalSpeakingMs: number
  isHost: boolean
  participantId: string | null
  participantName: string | null
}

interface MockParticipant {
  id: string
  name: string
  email: string
}

const MOCK_SPEAKERS: MockSpeaker[] = [
  {
    id: 's1',
    name: 'Markus Klooth',
    utteranceCount: 6,
    totalSpeakingMs: 52_000,
    isHost: true,
    participantId: 'p1',
    participantName: 'Markus Klooth',
  },
  {
    id: 's2',
    name: 'Sarah Chen',
    utteranceCount: 5,
    totalSpeakingMs: 43_500,
    isHost: false,
    participantId: 'p2',
    participantName: 'Sarah Chen',
  },
  {
    id: 's3',
    name: 'John',
    utteranceCount: 3,
    totalSpeakingMs: 26_000,
    isHost: false,
    participantId: null,
    participantName: null,
  },
]

const MOCK_PARTICIPANTS: MockParticipant[] = [
  { id: 'p1', name: 'Markus Klooth', email: 'markus@auxx-lift.com' },
  { id: 'p2', name: 'Sarah Chen', email: 'sarah@acme.com' },
  { id: 'p3', name: 'John Partner', email: 'john@partner.co' },
]

import { USE_MOCK_DATA } from '../constants'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

function getSpeakerInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function getSpeakingPercentage(speakerMs: number, totalMs: number): number {
  if (totalMs === 0) return 0
  return Math.round((speakerMs / totalMs) * 100)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RecordingSpeakersProps {
  recordingId?: string
}

export function RecordingSpeakers({ recordingId }: RecordingSpeakersProps) {
  const speakers = USE_MOCK_DATA ? MOCK_SPEAKERS : []
  const participants = USE_MOCK_DATA ? MOCK_PARTICIPANTS : []
  const totalSpeakingMs = speakers.reduce((sum, s) => sum + s.totalSpeakingMs, 0)

  if (speakers.length === 0) {
    return (
      <div className='flex flex-1 items-center justify-center p-6'>
        <EmptyState
          icon={Users}
          title='Speaker analysis not available'
          description='Speaker breakdown will appear here once the recording is processed.'
        />
      </div>
    )
  }

  return (
    <ScrollArea className='flex-1'>
      <div className='space-y-3 p-3 sm:p-6'>
        {/* Summary bar */}
        <div className='flex items-center gap-4 rounded-lg border p-3'>
          <div className='flex items-center gap-1.5 text-sm text-muted-foreground'>
            <Users className='size-4' />
            <span>{speakers.length} speakers</span>
          </div>
          <div className='flex items-center gap-1.5 text-sm text-muted-foreground'>
            <MessageSquare className='size-4' />
            <span>{speakers.reduce((sum, s) => sum + s.utteranceCount, 0)} utterances</span>
          </div>
          <div className='flex items-center gap-1.5 text-sm text-muted-foreground'>
            <Clock className='size-4' />
            <span>{formatDuration(totalSpeakingMs)} total</span>
          </div>
        </div>

        {/* Speaking time distribution bar */}
        <div className='flex h-2 overflow-hidden rounded-full'>
          {speakers.map((speaker, idx) => {
            const pct = getSpeakingPercentage(speaker.totalSpeakingMs, totalSpeakingMs)
            return (
              <div
                key={speaker.id}
                className={cn('h-full', SPEAKER_COLORS[idx % SPEAKER_COLORS.length])}
                style={{ width: `${pct}%` }}
              />
            )
          })}
        </div>

        {/* Speaker cards */}
        <div className='space-y-2'>
          {speakers.map((speaker, idx) => {
            const pct = getSpeakingPercentage(speaker.totalSpeakingMs, totalSpeakingMs)
            const color = SPEAKER_COLORS[idx % SPEAKER_COLORS.length]!

            return (
              <div key={speaker.id} className='rounded-lg border p-4'>
                <div className='flex items-start gap-3'>
                  {/* Avatar */}
                  <div
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white',
                      color
                    )}>
                    {getSpeakerInitials(speaker.name)}
                  </div>

                  {/* Info */}
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-2'>
                      <span className='text-sm font-medium truncate'>{speaker.name}</span>
                      {speaker.isHost && (
                        <Badge variant='secondary' className='text-[10px] px-1.5 py-0'>
                          Host
                        </Badge>
                      )}
                    </div>

                    <div className='flex items-center gap-3 mt-1 text-xs text-muted-foreground'>
                      <span>{speaker.utteranceCount} utterances</span>
                      <span>{formatDuration(speaker.totalSpeakingMs)}</span>
                      <span>{pct}% of total</span>
                    </div>

                    {/* Speaking time bar */}
                    <div className='mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden'>
                      <div
                        className={cn('h-full rounded-full', color)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    {/* Participant assignment */}
                    <div className='mt-3'>
                      <label className='text-xs text-muted-foreground mb-1 block'>
                        Linked participant
                      </label>
                      <Select
                        value={speaker.participantId ?? 'unassigned'}
                        onValueChange={(value) => {
                          // TODO: Call updateSpeaker mutation
                          // updateSpeaker.mutate({ speakerId: speaker.id, participantId: value })
                        }}>
                        <SelectTrigger className='h-8 text-xs'>
                          <SelectValue placeholder='Not assigned' />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='unassigned'>Not assigned</SelectItem>
                          {participants.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} ({p.email})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </ScrollArea>
  )
}
