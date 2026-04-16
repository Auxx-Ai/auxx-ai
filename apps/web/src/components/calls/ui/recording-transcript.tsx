// apps/web/src/components/calls/ui/recording-transcript.tsx
'use client'

import { toRecordId } from '@auxx/types/resource'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { FileText, Loader2 } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { api } from '~/trpc/react'
import { SpeakerBadge } from './speaker-badge'
import { useRecordingPlayer } from './use-recording-player'

// ---------------------------------------------------------------------------
// Transcript data shape (shared between mock + real data)
// ---------------------------------------------------------------------------

interface TranscriptUtteranceView {
  id: string
  speakerId: string
  /** Effective display name: contact → participant name/email → raw speaker label. */
  displayName: string
  /** Matched Contact entity instance id, if any. Drives RecordBadge rendering. */
  contactEntityInstanceId: string | null
  text: string
  startMs: number
  endMs: number
  sortOrder: number
  words: { text: string; startMs: number; endMs: number }[] | null
}

interface TranscriptView {
  id: string
  status: 'processing' | 'completed' | 'failed'
  utterances: TranscriptUtteranceView[]
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

const MOCK_TRANSCRIPT = {
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
} as unknown as TranscriptView

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RecordingTranscriptProps {
  recordingId?: string
}

export function RecordingTranscript({ recordingId }: RecordingTranscriptProps) {
  const { data: transcriptData, isLoading: transcriptLoading } =
    api.recording.getTranscript.useQuery(
      { recordingId: recordingId! },
      {
        enabled: !USE_MOCK_DATA && !!recordingId,
        refetchInterval: (query) =>
          (query.state.data as { status?: string } | null)?.status === 'processing' ? 3000 : false,
      }
    )

  const { data: utterancesData, isLoading: utterancesLoading } =
    api.recording.getUtterances.useQuery(
      { transcriptId: transcriptData?.id ?? '', limit: 200 },
      { enabled: !USE_MOCK_DATA && !!transcriptData?.id }
    )

  const transcript = useMemo<TranscriptView | null>(() => {
    if (USE_MOCK_DATA) {
      return {
        ...MOCK_TRANSCRIPT,
        utterances: MOCK_TRANSCRIPT.utterances.map((u) => ({
          id: u.id,
          speakerId: u.speakerId,
          displayName: (u as unknown as { speakerName: string }).speakerName,
          contactEntityInstanceId: null,
          text: u.text,
          startMs: u.startMs,
          endMs: u.endMs,
          sortOrder: u.sortOrder,
          words: u.words ?? null,
        })),
      }
    }
    if (!transcriptData) return null

    // Resolve effective display info per speaker:
    //   1. transcript-provider label (speaker.name) as the floor
    //   2. matched MeetingParticipant name/email wins over raw label
    // Contact linkage (→ RecordBadge) is kept as a separate field.
    const speakerInfo = new Map<
      string,
      { displayName: string; contactEntityInstanceId: string | null }
    >()
    for (const s of transcriptData.speakers) {
      const p = s.participant
      const participantLabel = p ? p.name || p.email || null : null
      speakerInfo.set(s.id, {
        displayName: participantLabel ?? s.name ?? 'Unknown',
        contactEntityInstanceId: p?.contactEntityInstanceId ?? null,
      })
    }

    const speakers = transcriptData.speakers.map((s, idx) => {
      const info = speakerInfo.get(s.id)
      return {
        id: s.id,
        name: info?.displayName ?? s.name,
        color: SPEAKER_COLORS[idx % SPEAKER_COLORS.length]!,
      }
    })

    const utterances: TranscriptUtteranceView[] = (utterancesData?.items ?? []).map((u) => {
      const info = speakerInfo.get(u.speakerId)
      return {
        id: u.id,
        speakerId: u.speakerId,
        displayName: info?.displayName ?? u.speaker?.name ?? 'Unknown',
        contactEntityInstanceId: info?.contactEntityInstanceId ?? null,
        text: u.text,
        startMs: u.startMs,
        endMs: u.endMs,
        sortOrder: u.sortOrder,
        words: (u.words as { text: string; startMs: number; endMs: number }[] | null) ?? null,
      }
    })

    return {
      id: transcriptData.id,
      status: transcriptData.status,
      utterances,
      speakers,
    }
  }, [transcriptData, utterancesData])

  if (!USE_MOCK_DATA && (transcriptLoading || (transcriptData && utterancesLoading))) {
    return (
      <div className='flex flex-1 items-center justify-center p-6'>
        <Loader2 className='size-6 animate-spin text-muted-foreground' />
      </div>
    )
  }

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

function TranscriptViewer({ transcript }: { transcript: TranscriptView }) {
  const currentTimeMs = useRecordingPlayer((s) => s.currentTimeMs)
  const seekTo = useRecordingPlayer((s) => s.seekTo)
  const [userScrolled, setUserScrolled] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
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

  // Attach a native scroll listener on the ScrollArea viewport so we can
  // pause auto-scroll when the user takes over.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onScroll = () => setUserScrolled(true)
    vp.addEventListener('scroll', onScroll, { passive: true })
    return () => vp.removeEventListener('scroll', onScroll)
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

  return (
    <div className='flex flex-1 flex-col min-h-0'>
      <ScrollArea className='flex-1' viewportRef={viewportRef}>
        <div className='space-y-4 p-3 sm:p-6'>
          {transcript.utterances.map((utterance) => {
            const speakerColor = speakerColorMap.get(utterance.speakerId) ?? SPEAKER_COLORS[0]!

            return (
              <div key={utterance.id} className='min-w-0'>
                <div className='flex items-center justify-between gap-2 mb-1'>
                  <SpeakerBadge
                    contactRecordId={
                      utterance.contactEntityInstanceId
                        ? toRecordId('contact', utterance.contactEntityInstanceId)
                        : null
                    }
                    name={utterance.displayName}
                    avatarColor={speakerColor}
                    variant={utterance.contactEntityInstanceId ? 'link' : 'default'}
                    link={!!utterance.contactEntityInstanceId}
                  />
                  <button
                    type='button'
                    className='text-xs text-muted-foreground hover:text-foreground transition-colors'
                    onClick={() => handleSeek(utterance.startMs)}>
                    {formatTimestamp(utterance.startMs)}
                  </button>
                </div>

                <div
                  ref={(el) => setUtteranceRef(utterance.id, el)}
                  className={cn(
                    'group relative rounded-md px-2 py-1 -mx-2 transition-colors',
                    !utterance.words?.length && 'cursor-pointer',
                    currentUtteranceId === utterance.id && !utterance.words?.length
                      ? 'bg-primary/10'
                      : !utterance.words?.length && 'hover:bg-muted/50'
                  )}
                  onClick={
                    utterance.words?.length ? undefined : () => handleSeek(utterance.startMs)
                  }>
                  {utterance.words && utterance.words.length > 0 ? (
                    <p className='text-sm leading-relaxed'>
                      {utterance.words.map((w, i) => {
                        const isActive = currentTimeMs >= w.startMs && currentTimeMs <= w.endMs
                        return (
                          // biome-ignore lint/suspicious/noArrayIndexKey: word order is stable per utterance
                          <Fragment key={i}>
                            <span
                              onClick={(e) => {
                                e.stopPropagation()
                                handleSeek(w.startMs)
                              }}
                              className={cn(
                                'cursor-pointer rounded transition-colors hover:bg-primary/10',
                                isActive && 'bg-primary/20 text-foreground'
                              )}>
                              {w.text}
                            </span>
                            {i < utterance.words!.length - 1 ? ' ' : null}
                          </Fragment>
                        )
                      })}
                    </p>
                  ) : (
                    <p className='text-sm leading-relaxed'>{utterance.text}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
