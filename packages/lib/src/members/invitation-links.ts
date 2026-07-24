// packages/lib/src/members/invitation-links.ts

import { WEBAPP_URL } from '@auxx/config/server'

/** Default expiration time for invitations (e.g., 7 days). */
export const INVITATION_EXPIRATION_HOURS = 7 * 24

/** Build the full accept-invitation link for a token. */
export function generateAcceptLink(token: string): string {
  const baseUrl = WEBAPP_URL || 'http://localhost:3000'
  // Ensure no double slashes if baseUrl ends with / and path starts with /
  const acceptPath = '/accept-invitation'
  return `${baseUrl.replace(/\/$/, '')}${acceptPath}?token=${token}`
}

/** Build the signup link (carries the token so signup/login can retrieve it later). */
export function generateSignupLink(token: string): string {
  const baseUrl = WEBAPP_URL || 'http://localhost:3000'
  const signupPath = '/signup' // Point to the signup page
  return `${baseUrl.replace(/\/$/, '')}${signupPath}?invitationToken=${token}`
}
