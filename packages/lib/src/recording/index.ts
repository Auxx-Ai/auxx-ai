// packages/lib/src/recording/index.ts

export * from './bot'
export * from './calendar'
export {
  createCallRecording,
  findOrgsWithRecordingEnabled,
  findRecording,
  findUpcomingCalendarEvents,
  getRecordingDetail,
  listRecordings,
  updateRecording,
} from './recording-queries'
export {
  createMeeting,
  deleteRecording,
  getRecordingVideoUrl,
  scheduleRecording,
} from './recording-service'
export type { TranscriptionProvider } from './transcription'
export {
  getTranscript,
  getUtterances,
  matchSpeakersToParticipants,
  processTranscript,
  updateSpeakerParticipant,
} from './transcription'
