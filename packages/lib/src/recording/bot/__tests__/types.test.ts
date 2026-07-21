// packages/lib/src/recording/bot/__tests__/types.test.ts

import { describe, expect, it } from 'vitest'
import {
  deriveRecordingOutcome,
  FAILURE_REASONS,
  FAILURE_SUB_CODE_STATUS,
  formatRecordingFailure,
} from '../types'

describe('deriveRecordingOutcome', () => {
  it('maps failure-terminal statuses to no_recording', () => {
    for (const status of ['failed', 'kicked', 'denied', 'timeout', 'cancelled'] as const) {
      expect(deriveRecordingOutcome({ status })).toBe('no_recording')
    }
  })

  it('maps completed without artifacts to no_recording', () => {
    expect(deriveRecordingOutcome({ status: 'completed' })).toBe('no_recording')
    expect(deriveRecordingOutcome({ status: 'completed', videoAssetId: null })).toBe('no_recording')
  })

  it('maps completed with a transcript or video to ready', () => {
    expect(deriveRecordingOutcome({ status: 'completed', hasTranscript: true })).toBe('ready')
    expect(deriveRecordingOutcome({ status: 'completed', videoAssetId: 'asset_1' })).toBe('ready')
  })

  it('maps pre-meeting statuses to scheduled', () => {
    expect(deriveRecordingOutcome({ status: 'created' })).toBe('scheduled')
    expect(deriveRecordingOutcome({ status: 'joining' })).toBe('scheduled')
  })

  it('maps in-progress statuses to live', () => {
    for (const status of ['waiting', 'admitted', 'recording', 'processing'] as const) {
      expect(deriveRecordingOutcome({ status })).toBe('live')
    }
  })
})

describe('failure sub_code mapping', () => {
  it('maps waiting-room timeouts to timeout status', () => {
    expect(FAILURE_SUB_CODE_STATUS.timeout_exceeded_waiting_room).toBe('timeout')
    expect(FAILURE_SUB_CODE_STATUS.call_ended_by_platform_waiting_room_timeout).toBe('timeout')
  })

  it('maps blocked bots to denied status', () => {
    expect(FAILURE_SUB_CODE_STATUS.google_meet_bot_blocked).toBe('denied')
    expect(FAILURE_SUB_CODE_STATUS.zoom_bot_blocked).toBe('denied')
  })

  it('has a human-readable reason for every mapped sub_code', () => {
    for (const subCode of Object.keys(FAILURE_SUB_CODE_STATUS)) {
      expect(FAILURE_REASONS[subCode], `missing reason for ${subCode}`).toBeTruthy()
    }
  })
})

describe('formatRecordingFailure', () => {
  it('translates known sub_codes and statuses', () => {
    expect(formatRecordingFailure('timeout_exceeded_waiting_room')).toBe(
      'The notetaker was never admitted to the meeting'
    )
    expect(formatRecordingFailure('timeout')).toBe(
      'The notetaker was never admitted to the meeting'
    )
  })

  it('passes through already-friendly reasons', () => {
    expect(formatRecordingFailure('Bot was denied entry to the meeting')).toBe(
      'Bot was denied entry to the meeting'
    )
  })

  it('falls back to generic copy when empty', () => {
    expect(formatRecordingFailure(null)).toBe('The meeting ended without a recording')
    expect(formatRecordingFailure(undefined)).toBe('The meeting ended without a recording')
  })
})
