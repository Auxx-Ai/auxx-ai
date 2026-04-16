// apps/web/src/components/calls/ui/recording-speakers.tsx
'use client'

import { toRecordId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { pluralize } from '@auxx/utils/strings'
import { BarChart3, Check, Clock, Users } from 'lucide-react'
import { useMemo } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { api } from '~/trpc/react'
import { SpeakerBadge } from './speaker-badge'

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

interface SpeakerView {
  id: string
  /** Effective display name: participant name/email → raw speaker label. */
  displayName: string
  utteranceCount: number
  totalSpeakingMs: number
  isHost: boolean
  participantId: string | null
  contactEntityInstanceId: string | null
}

interface ParticipantView {
  id: string
  name: string
  email: string
}

const MOCK_SPEAKERS: SpeakerView[] = [
  {
    id: 's1',
    displayName: 'Markus Klooth',
    utteranceCount: 6,
    totalSpeakingMs: 52_000,
    isHost: true,
    participantId: 'p1',
    contactEntityInstanceId: null,
  },
  {
    id: 's2',
    displayName: 'Sarah Chen',
    utteranceCount: 5,
    totalSpeakingMs: 43_500,
    isHost: false,
    participantId: 'p2',
    contactEntityInstanceId: null,
  },
  {
    id: 's3',
    displayName: 'John',
    utteranceCount: 3,
    totalSpeakingMs: 26_000,
    isHost: false,
    participantId: null,
    contactEntityInstanceId: null,
  },
]

const MOCK_PARTICIPANTS: ParticipantView[] = [
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
  const utils = api.useUtils()

  const { data: transcript } = api.recording.getTranscript.useQuery(
    { recordingId: recordingId! },
    { enabled: !USE_MOCK_DATA && !!recordingId }
  )

  const { data: recording } = api.recording.getById.useQuery(
    { id: recordingId! },
    { enabled: !USE_MOCK_DATA && !!recordingId }
  )

  const updateSpeaker = api.recording.updateSpeaker.useMutation({
    onSuccess: () => {
      utils.recording.getTranscript.invalidate({ recordingId: recordingId! })
    },
    onError: (error) => {
      toastError({ title: 'Failed to update speaker', description: error.message })
    },
  })

  const participants: ParticipantView[] = useMemo(() => {
    if (USE_MOCK_DATA) return MOCK_PARTICIPANTS
    return (recording?.participants ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
    }))
  }, [recording])

  const speakers: SpeakerView[] = useMemo(() => {
    if (USE_MOCK_DATA) return MOCK_SPEAKERS
    if (!transcript) return []
    return transcript.speakers.map((s) => {
      const p = s.participant
      const participantLabel = p ? p.name || p.email || null : null
      return {
        id: s.id,
        displayName: participantLabel ?? s.name ?? 'Unknown',
        utteranceCount: Number(s.utteranceCount ?? 0),
        totalSpeakingMs: Number(s.totalSpeakingMs ?? 0),
        isHost: !!s.isHost,
        participantId: p?.id ?? null,
        contactEntityInstanceId: p?.contactEntityInstanceId ?? null,
      }
    })
  }, [transcript])

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
      <div className=''>
        <Section title='Summary' icon={<BarChart3 className='size-3.5' />} collapsible={false}>
          <div className='space-y-2'>
            <div className='flex items-center gap-2 text-sm'>
              <Users className='size-4 shrink-0 text-muted-foreground' />
              <span>
                {speakers.length} {pluralize(speakers.length, 'speaker')}
              </span>
            </div>
            <div className='flex items-center gap-2 text-sm'>
              <Clock className='size-4 shrink-0 text-muted-foreground' />
              <span>{formatDuration(totalSpeakingMs)} total</span>
            </div>
          </div>
        </Section>

        {/* Speaking time distribution bar */}
        {/* <div className='flex h-2 overflow-hidden rounded-full'>
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
        </div> */}

        {/* Speaker cards */}
        <div className='space-y-2 p-3 sm:p-6'>
          {speakers.map((speaker, idx) => {
            const pct = getSpeakingPercentage(speaker.totalSpeakingMs, totalSpeakingMs)
            const color = SPEAKER_COLORS[idx % SPEAKER_COLORS.length]!

            return (
              <div key={speaker.id} className=''>
                <div className='flex items-center justify-between gap-3'>
                  <div className='flex items-center gap-2'>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type='button'
                          disabled={updateSpeaker.isPending}
                          className='focus:outline-none'>
                          <SpeakerBadge
                            contactRecordId={
                              speaker.contactEntityInstanceId
                                ? toRecordId('contact', speaker.contactEntityInstanceId)
                                : null
                            }
                            name={speaker.displayName}
                            avatarColor={color}
                            variant='link'
                            link={false}
                          />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='start' className='w-64'>
                        <DropdownMenuLabel>Linked participant</DropdownMenuLabel>
                        {participants.length === 0 ? (
                          <DropdownMenuItem disabled>No participants</DropdownMenuItem>
                        ) : (
                          participants.map((p) => (
                            <DropdownMenuItem
                              key={p.id}
                              onSelect={() =>
                                updateSpeaker.mutate({
                                  speakerId: speaker.id,
                                  participantId: p.id,
                                })
                              }
                              className='flex items-center justify-between gap-2'>
                              <div className='flex min-w-0 flex-col'>
                                <span className='truncate text-sm'>{p.name}</span>
                                <span className='truncate text-xs text-muted-foreground'>
                                  {p.email}
                                </span>
                              </div>
                              {speaker.participantId === p.id && (
                                <Check className='size-3.5 shrink-0 text-muted-foreground' />
                              )}
                            </DropdownMenuItem>
                          ))
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {speaker.isHost && (
                      <Badge variant='secondary' className='text-[10px] px-1.5 py-0'>
                        Host
                      </Badge>
                    )}
                  </div>

                  <div className='flex items-center gap-3 text-xs text-muted-foreground'>
                    <span>{formatDuration(speaker.totalSpeakingMs)}</span>
                    <span>{pct}%</span>
                  </div>
                </div>

                <div className='mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden'>
                  <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </ScrollArea>
  )
}
