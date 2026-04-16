// apps/web/src/components/calls/ui/recording-transcript.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { FileText, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { useRecordingPlayer } from './use-recording-player'

// ---------------------------------------------------------------------------
// Mock transcript data
// ---------------------------------------------------------------------------

interface MockUtterance {
  id: string
  speakerId: string
  speakerName: string
  text: string
  startMs: number
  endMs: number
  sortOrder: number
}

interface MockTranscriptData {
  id: string
  status: 'processing' | 'completed' | 'failed'
  utterances: MockUtterance[]
  speakers: { id: string; name: string; color: string }[]
}

const SPEAKER_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-rose-500',
  'bg-cyan-500',
]

const MOCK_TRANSCRIPT: MockTranscriptData = {
  id: 'transcript_001',
  status: 'completed',
  utterances: [
    {
      id: 'u1',
      speakerId: 's1',
      speakerName: 'Markus Klooth',
      text: "Hello everyone, thanks for joining. Let's go over the Q2 roadmap and make sure we're aligned on priorities.",
      startMs: 0,
      endMs: 8000,
      sortOrder: 0,
    },
    {
      id: 'u2',
      speakerId: 's2',
      speakerName: 'Sarah Chen',
      text: 'Sounds good. I wanted to start with the API migration timeline since that affects the most teams.',
      startMs: 8500,
      endMs: 15000,
      sortOrder: 1,
    },
    {
      id: 'u3',
      speakerId: 's1',
      speakerName: 'Markus Klooth',
      text: "Sure, go ahead. We're targeting end of May for the breaking changes. The v2 endpoints are already in staging.",
      startMs: 15500,
      endMs: 23000,
      sortOrder: 2,
    },
    {
      id: 'u4',
      speakerId: 's2',
      speakerName: 'Sarah Chen',
      text: "That works for us. We'll need about two weeks for integration testing on our side. Can we get access to the staging environment by next Monday?",
      startMs: 23500,
      endMs: 32000,
      sortOrder: 3,
    },
    {
      id: 'u5',
      speakerId: 's1',
      speakerName: 'Markus Klooth',
      text: "Absolutely, I'll send over the credentials today. John, can you set up the test accounts for Sarah's team?",
      startMs: 32500,
      endMs: 39000,
      sortOrder: 4,
    },
    {
      id: 'u6',
      speakerId: 's3',
      speakerName: 'John',
      text: "Yeah, I can do that this afternoon. I'll also document the new auth flow since that's changed significantly.",
      startMs: 39500,
      endMs: 47000,
      sortOrder: 5,
    },
    {
      id: 'u7',
      speakerId: 's2',
      speakerName: 'Sarah Chen',
      text: 'That would be really helpful. The auth changes were the part we were most concerned about. Is there a migration guide?',
      startMs: 47500,
      endMs: 55000,
      sortOrder: 6,
    },
    {
      id: 'u8',
      speakerId: 's3',
      speakerName: 'John',
      text: "I'm working on one. Should have a draft by Wednesday. The main difference is we moved from API keys to OAuth2 with PKCE.",
      startMs: 55500,
      endMs: 64000,
      sortOrder: 7,
    },
    {
      id: 'u9',
      speakerId: 's1',
      speakerName: 'Markus Klooth',
      text: "Great. Let's move on to the recording feature. We launched the beta last week and the feedback has been very positive so far.",
      startMs: 64500,
      endMs: 73000,
      sortOrder: 8,
    },
    {
      id: 'u10',
      speakerId: 's2',
      speakerName: 'Sarah Chen',
      text: 'I saw the demo. The transcription quality is impressive. Are you planning to add speaker diarization?',
      startMs: 73500,
      endMs: 81000,
      sortOrder: 9,
    },
    {
      id: 'u11',
      speakerId: 's1',
      speakerName: 'Markus Klooth',
      text: "Yes, that's actually what we're building right now. The transcript already identifies speakers, and we're adding the UI to visualize it.",
      startMs: 81500,
      endMs: 90000,
      sortOrder: 10,
    },
    {
      id: 'u12',
      speakerId: 's3',
      speakerName: 'John',
      text: "We're also working on the AI summary feature for Phase 4. It will generate meeting notes, action items, and key insights automatically.",
      startMs: 90500,
      endMs: 100000,
      sortOrder: 11,
    },
    {
      id: 'u13',
      speakerId: 's2',
      speakerName: 'Sarah Chen',
      text: 'That sounds amazing. Our team has been asking for exactly that. When do you think it will be ready?',
      startMs: 100500,
      endMs: 108000,
      sortOrder: 12,
    },
    {
      id: 'u14',
      speakerId: 's1',
      speakerName: 'Markus Klooth',
      text: "We're aiming for end of Q2, so late June. The transcription pipeline needs to be solid first before we can build AI on top of it.",
      startMs: 108500,
      endMs: 118000,
      sortOrder: 13,
    },
    {
      id: 'u15',
      speakerId: 's2',
      speakerName: 'Sarah Chen',
      text: 'Makes sense. Alright, I think that covers everything from my side. Thanks for the update everyone.',
      startMs: 118500,
      endMs: 125000,
      sortOrder: 14,
    },
    {
      id: 'u16',
      speakerId: 's1',
      speakerName: 'Markus Klooth',
      text: "Thanks Sarah, thanks John. Let's sync again next week to check on the staging access and migration guide progress.",
      startMs: 125500,
      endMs: 133000,
      sortOrder: 15,
    },
  ],
  speakers: [
    { id: 's1', name: 'Markus Klooth', color: SPEAKER_COLORS[0]! },
    { id: 's2', name: 'Sarah Chen', color: SPEAKER_COLORS[1]! },
    { id: 's3', name: 'John', color: SPEAKER_COLORS[2]! },
  ],
}

import { USE_MOCK_DATA } from '../constants'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function getSpeakerInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RecordingTranscriptProps {
  recordingId?: string
}

export function RecordingTranscript({ recordingId }: RecordingTranscriptProps) {
  // TODO: Replace mock data with real tRPC queries
  // const { data: transcript } = api.recording.getTranscript.useQuery(
  //   { recordingId: recordingId! },
  //   { enabled: !USE_MOCK_DATA && !!recordingId }
  // )

  const transcript = USE_MOCK_DATA ? MOCK_TRANSCRIPT : null

  if (!transcript) {
    return (
      <div className='flex flex-1 items-center justify-center p-6'>
        <EmptyState
          icon={FileText}
          title='Transcript not available'
          description='The transcript will appear here once the recording is processed.'
        />
      </div>
    )
  }

  if (transcript.status === 'processing') {
    return (
      <div className='flex flex-1 items-center justify-center p-6'>
        <div className='flex flex-col items-center gap-3 text-muted-foreground'>
          <Loader2 className='size-8 animate-spin' />
          <span className='text-sm'>Transcribing...</span>
        </div>
      </div>
    )
  }

  if (transcript.status === 'failed') {
    return (
      <div className='flex flex-1 items-center justify-center p-6'>
        <EmptyState
          icon={FileText}
          title='Transcription failed'
          description='There was an error processing the transcript. Please try again.'
        />
      </div>
    )
  }

  if (transcript.utterances.length === 0) {
    return (
      <div className='flex flex-1 items-center justify-center p-6'>
        <EmptyState
          icon={FileText}
          title='No speech detected'
          description='The recording was processed but no speech was found.'
        />
      </div>
    )
  }

  return <TranscriptViewer transcript={transcript} />
}

// ---------------------------------------------------------------------------
// TranscriptViewer — scrollable utterance list with video sync
// ---------------------------------------------------------------------------

function TranscriptViewer({ transcript }: { transcript: MockTranscriptData }) {
  const currentTimeMs = useRecordingPlayer((s) => s.currentTimeMs)
  const seekTo = useRecordingPlayer((s) => s.seekTo)
  const [userScrolled, setUserScrolled] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const utteranceRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const speakerColorMap = new Map(transcript.speakers.map((s) => [s.id, s.color]))

  // Find the current utterance based on playback time
  const currentUtteranceId = transcript.utterances.find(
    (u) => currentTimeMs >= u.startMs && currentTimeMs <= u.endMs
  )?.id

  // Auto-scroll to current utterance during playback
  useEffect(() => {
    if (userScrolled || !currentUtteranceId) return

    const el = utteranceRefs.current.get(currentUtteranceId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentUtteranceId, userScrolled])

  // Reset user-scroll override after 5s of inactivity
  useEffect(() => {
    if (!userScrolled) return

    const timer = setTimeout(() => setUserScrolled(false), 5000)
    return () => clearTimeout(timer)
  }, [userScrolled])

  const handleScroll = useCallback(() => {
    setUserScrolled(true)
  }, [])

  const handleSeek = useCallback(
    (ms: number) => {
      seekTo?.(ms)
      setUserScrolled(false)
    },
    [seekTo]
  )

  const setUtteranceRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      utteranceRefs.current.set(id, el)
    } else {
      utteranceRefs.current.delete(id)
    }
  }, [])

  // Group consecutive utterances by the same speaker
  const groups = groupBySpeaker(transcript.utterances)

  return (
    <div className='flex flex-1 flex-col min-h-0'>
      <ScrollArea className='flex-1' onScrollCapture={handleScroll}>
        <div ref={scrollRef} className='space-y-4 p-3 sm:p-6'>
          {groups.map((group) => {
            const speakerColor = speakerColorMap.get(group.speakerId) ?? SPEAKER_COLORS[0]!

            return (
              <div key={group.utterances[0]!.id} className='flex gap-3'>
                {/* Speaker avatar */}
                <div className='flex flex-col items-center pt-0.5'>
                  <div
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white',
                      speakerColor
                    )}>
                    {getSpeakerInitials(group.speakerName)}
                  </div>
                </div>

                {/* Utterances */}
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2 mb-1'>
                    <span className='text-sm font-medium truncate'>{group.speakerName}</span>
                    <button
                      type='button'
                      className='text-xs text-muted-foreground hover:text-foreground transition-colors'
                      onClick={() => handleSeek(group.utterances[0]!.startMs)}>
                      {formatTimestamp(group.utterances[0]!.startMs)}
                    </button>
                  </div>

                  <div className='space-y-1'>
                    {group.utterances.map((utterance) => (
                      <div
                        key={utterance.id}
                        ref={(el) => setUtteranceRef(utterance.id, el)}
                        className={cn(
                          'group relative rounded-md px-2 py-1 -mx-2 transition-colors cursor-pointer',
                          currentUtteranceId === utterance.id
                            ? 'bg-primary/10'
                            : 'hover:bg-muted/50'
                        )}
                        onClick={() => handleSeek(utterance.startMs)}>
                        <p className='text-sm leading-relaxed'>{utterance.text}</p>
                        <Badge
                          variant='outline'
                          className='absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-1.5 py-0'>
                          {formatTimestamp(utterance.startMs)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Grouping helper
// ---------------------------------------------------------------------------

interface SpeakerGroup {
  speakerId: string
  speakerName: string
  utterances: MockUtterance[]
}

function groupBySpeaker(utterances: MockUtterance[]): SpeakerGroup[] {
  const groups: SpeakerGroup[] = []

  for (const utterance of utterances) {
    const lastGroup = groups[groups.length - 1]

    if (lastGroup && lastGroup.speakerId === utterance.speakerId) {
      lastGroup.utterances.push(utterance)
    } else {
      groups.push({
        speakerId: utterance.speakerId,
        speakerName: utterance.speakerName,
        utterances: [utterance],
      })
    }
  }

  return groups
}
