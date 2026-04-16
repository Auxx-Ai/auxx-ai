// packages/lib/src/recording/transcription/index.ts

export { matchSpeakersToParticipants } from './speaker-matcher'
export { getTranscript, getUtterances, updateSpeakerParticipant } from './transcript-queries'
export { processTranscript, type TranscriptionProvider } from './transcription-service'
