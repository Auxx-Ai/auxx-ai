// packages/lib/src/ingest/domain/personal-domains.ts

import freeEmailDomains from 'free-email-domains'

/**
 * Set of personal / free email provider domains (gmail, yahoo, proton, etc.).
 * Built once at module load from the `free-email-domains` package (~4500 entries).
 */
export const PERSONAL_EMAIL_DOMAINS: ReadonlySet<string> = new Set(
  (freeEmailDomains as string[]).map((d) => d.toLowerCase().trim())
)
