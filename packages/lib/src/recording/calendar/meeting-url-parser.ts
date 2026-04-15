// packages/lib/src/recording/calendar/meeting-url-parser.ts

import type { MeetingUrlMatch } from './types'

/**
 * Google Meet URL matcher.
 */
const GOOGLE_MEET_REGEX = /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}\b/i

/**
 * Zoom URL matcher.
 */
const ZOOM_REGEX = /https:\/\/(?:[\w-]+\.)?zoom\.us\/(?:j|my)\/\S+/i

/**
 * Microsoft Teams URL matcher.
 */
const TEAMS_REGEX = /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/\S+/i

/**
 * Matchers evaluated in priority order for free-text URL parsing.
 */
const URL_MATCHERS: Array<{ regex: RegExp; platform: MeetingUrlMatch['platform'] }> = [
  { regex: GOOGLE_MEET_REGEX, platform: 'google_meet' },
  { regex: ZOOM_REGEX, platform: 'zoom' },
  { regex: TEAMS_REGEX, platform: 'teams' },
]

/**
 * Event input accepted by the meeting URL parser.
 */
export interface MeetingUrlParseInput {
  location?: string | null
  description?: string | null
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType?: string | null
      uri?: string | null
    }>
  } | null
}

/**
 * Detect the meeting URL for a calendar event.
 */
export function parseMeetingUrl(event: MeetingUrlParseInput): MeetingUrlMatch | null {
  const conferenceUrl = extractConferenceUrl(event)
  if (conferenceUrl) {
    return classifyMeetingUrl(conferenceUrl)
  }

  const textBlocks = [event.location, event.description]
  for (const block of textBlocks) {
    if (!block) continue
    const match = matchTextForMeetingUrl(block)
    if (match) return match
  }

  return null
}

/**
 * Extract the explicit video conference URL from provider conference data.
 */
function extractConferenceUrl(event: MeetingUrlParseInput): string | null {
  const entryPoints = event.conferenceData?.entryPoints ?? []
  for (const entryPoint of entryPoints) {
    if (entryPoint.entryPointType !== 'video') continue
    const uri = entryPoint.uri?.trim()
    if (uri) return uri
  }

  return null
}

/**
 * Scan a text block with known meeting URL matchers.
 */
function matchTextForMeetingUrl(text: string): MeetingUrlMatch | null {
  for (const matcher of URL_MATCHERS) {
    const match = text.match(matcher.regex)
    if (!match?.[0]) continue
    return {
      url: match[0],
      platform: matcher.platform,
    }
  }

  return null
}

/**
 * Classify a discovered URL into a supported meeting platform.
 */
function classifyMeetingUrl(url: string): MeetingUrlMatch {
  const normalizedUrl = url.trim()
  const matched = matchTextForMeetingUrl(normalizedUrl)

  if (matched) {
    return {
      url: normalizedUrl,
      platform: matched.platform,
    }
  }

  return {
    url: normalizedUrl,
    platform: 'unknown',
  }
}
