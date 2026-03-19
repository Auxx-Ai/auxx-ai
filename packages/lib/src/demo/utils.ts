// packages/lib/src/demo/utils.ts

import { configService } from '@auxx/credentials'

/** Whether the demo system is enabled for this deployment. */
export function isDemoEnabled(): boolean {
  return configService.get<boolean>('DEMO_ENABLED', false) === true
}

/**
 * Check if an organization is a demo organization.
 * Demo orgs have a non-null demoExpiresAt timestamp.
 */
export function isDemoOrganization(org: { demoExpiresAt: Date | string | null }): boolean {
  return org.demoExpiresAt !== null
}

/**
 * Check if a demo organization has expired.
 * Returns false for non-demo orgs.
 */
export function isDemoExpired(org: { demoExpiresAt: Date | string | null }): boolean {
  if (org.demoExpiresAt === null) return false
  const expiresAt =
    typeof org.demoExpiresAt === 'string' ? new Date(org.demoExpiresAt) : org.demoExpiresAt
  return expiresAt < new Date()
}

/** Default demo session duration: 1 hour */
export const DEMO_SESSION_DURATION_MS = 60 * 60 * 1000

/** Demo user email domain */
export const DEMO_EMAIL_DOMAIN = 'demo.auxx.ai'

/**
 * Generate a demo user email address.
 */
export function generateDemoEmail(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let suffix = ''
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)]
  }
  return `demo-${suffix}@${DEMO_EMAIL_DOMAIN}`
}
