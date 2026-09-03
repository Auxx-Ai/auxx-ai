// packages/lib/src/companies/index.ts

export { domainFromUrl, domainFromWebsite } from './enrichment/derive-domain'
export type { EnrichCompanyJobData } from './enrichment/enqueue'
export { ENRICH_COMPANY_JOB_NAME, enqueueCompanyEnrichment } from './enrichment/enqueue'
export type { CompanyEnrichmentOutcome, EnrichCompanyInput } from './enrichment/enrich'
export { enrichCompany } from './enrichment/enrich'
export type {
  CompanyEnrichmentState,
  EnrichDecision,
  EnrichmentStatus,
  EnrichReason,
  EnrichSkipReason,
} from './enrichment/guards'
export {
  CLAIM_TTL_MS,
  ENRICHED_TTL_MS,
  FAILED_TTL_MS,
  ORG_WINDOW_LIMIT,
  ORG_WINDOW_MS,
  shouldEnrich,
} from './enrichment/guards'
export type { WebsiteMetadata } from './enrichment/metadata'
export {
  cleanText,
  fetchAndStoreLogo,
  fetchWebsiteMetadata,
  isEmptyMetadata,
} from './enrichment/metadata'
export type {
  EnrichmentCandidate,
  EnrichmentSweepOptions,
  EnrichmentSweepSummary,
} from './enrichment/sweep'
export {
  findCompaniesNeedingEnrichment,
  sweepCompaniesNeedingEnrichment,
} from './enrichment/sweep'
