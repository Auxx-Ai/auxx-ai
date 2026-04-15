// packages/lib/src/recording/calendar/meeting-url-parser.test.ts

import { describe, expect, it } from 'vitest'
import { parseMeetingUrl } from './meeting-url-parser'

/**
 * Unit tests for the calendar meeting URL parser.
 */
describe('parseMeetingUrl', () => {
  /**
   * Prefer conferenceData video entry points when available.
   */
  it('prefers conferenceData video entry points', () => {
    const result = parseMeetingUrl({
      conferenceData: {
        entryPoints: [
          {
            entryPointType: 'video',
            uri: 'https://meet.google.com/abc-defg-hij',
          },
        ],
      },
      location: 'https://zoom.us/j/123',
    })

    expect(result).toEqual({
      url: 'https://meet.google.com/abc-defg-hij',
      platform: 'google_meet',
    })
  })

  /**
   * Detect Zoom links in free text.
   */
  it('detects zoom links from description text', () => {
    const result = parseMeetingUrl({
      description: 'Join here: https://acme.zoom.us/j/123456789?pwd=secret',
    })

    expect(result).toEqual({
      url: 'https://acme.zoom.us/j/123456789?pwd=secret',
      platform: 'zoom',
    })
  })

  /**
   * Detect Teams links from event location.
   */
  it('detects teams links from location text', () => {
    const result = parseMeetingUrl({
      location: 'Conference bridge https://teams.microsoft.com/l/meetup-join/19%3ameeting_example',
    })

    expect(result).toEqual({
      url: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_example',
      platform: 'teams',
    })
  })

  /**
   * Return null when no meeting URL exists.
   */
  it('returns null when no supported meeting URL is present', () => {
    const result = parseMeetingUrl({
      location: 'HQ board room',
      description: 'Quarterly planning session',
    })

    expect(result).toBeNull()
  })
})
