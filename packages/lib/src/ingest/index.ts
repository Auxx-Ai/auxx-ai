// packages/lib/src/ingest/index.ts

export { findOrCreateCompanyByDomain } from './companies/find-or-create'
export type { LinkContactArgs } from './companies/link-contact'
export { linkContactToCompanyByDomain } from './companies/link-contact'
export {
  classifyForCompany,
  extractRegistrableDomain,
  getOwnDomains,
  isExcludedTld,
  isOwnDomain,
  isPersonalDomain,
  normalizeDomain,
} from './domain/classifier'
export { EXCLUDED_TLDS } from './domain/excluded-tlds'
export { PERSONAL_EMAIL_DOMAINS } from './domain/personal-domains'
