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

/**
 * Build the entry-point link for an invitee, based on whether they already have
 * an account.
 *
 * An existing user signs in and accepts directly. A brand-new invitee has no
 * account to sign in with, so they get the signup link — which carries the
 * token, letting signup bind the new account to the invited address. Handing a
 * new invitee the accept link instead strands them on the login page with the
 * token reduced to an opaque `callbackUrl`, which is how an invitee ends up
 * signing up under a different address and seeding a throwaway organization.
 *
 * Every surface that hands out an invitation link must go through here so the
 * emailed, resent, and copied links cannot disagree.
 */
export function generateInvitationEntryLink(token: string, hasAccount: boolean): string {
  return hasAccount ? generateAcceptLink(token) : generateSignupLink(token)
}
