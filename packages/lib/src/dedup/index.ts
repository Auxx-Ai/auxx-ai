// packages/lib/src/dedup/index.ts

export {
  type BlockGroup,
  type BlockIdentityParams,
  type BlockMatch,
  type BlockOrgKeyParams,
  type BlockRecordParams,
  blockIdentity,
  blockOrgKey,
  blockRecord,
  foldGmailAddress,
  type IdentityGroup,
  isRoleEmail,
} from './blocking'
export {
  type BlockFuzzyParams,
  type BlockSurnameParams,
  blockFuzzyRecord,
  blockSurnameRecord,
  type FuzzyBlockAnchors,
  type FuzzyCandidate,
} from './blocking-fuzzy'
export {
  BAND_THRESHOLDS,
  BLOCK_CAP,
  CORROBORATING_WEIGHTS,
  CORROBORATION_WEIGHT,
  DEDUP_CONFIG_BY_ENTITY_TYPE,
  DEDUP_DENYLIST,
  DEDUP_V1_ALLOWLIST,
  FUZZY_BLOCK_LIMIT,
  getDedupConfig,
  MAX_CORROBORATION_SCORE,
  ROLE_EMAIL_LOCALS,
  SIGNAL_WEIGHTS,
  STRONG_KEY_SYSTEM_ATTRIBUTES,
  SURNAME_ANCHOR_LIMIT,
  SURNAME_RARE_MAX_SHARE,
  SURNAME_RARE_MIN_COUNT,
  SURNAME_TRIGRAM_THRESHOLD,
} from './config'
export {
  type CorroboratePairParams,
  type CorroborationFields,
  corroboratePair,
  deriveCorroborationFields,
  type EvaluateFuzzyPairParams,
  evaluateFuzzyPair,
  normalizeAddressValue,
} from './corroborate'
export {
  type EmitIdentityPairsParams,
  emitPairsFromIdentityMatch,
} from './emit-identity-pairs'
export {
  DUPLICATE_SCAN_CONTINUATION_DELAY_MS,
  DUPLICATE_SCAN_DELAY_MS,
  DUPLICATE_SCAN_JOB_NAME,
  type EnqueueScanForRecordsParams,
  enqueueDuplicateScan,
  enqueueDuplicateScanContinuation,
  enqueueDuplicateScanForRecords,
} from './enqueue-scan'
export { deriveMatchKeys, type MatchKey, type MatchKeyColumn } from './match-keys'
export {
  compareStructuredNames,
  decideNameSignal,
  type NameComparison,
  type NameRuleOutcome,
  type NameRuleParams,
  type NameRuleReason,
  normalizeSurname,
  type StructuredName,
  type SurnameMatch,
  trigramSimilarity,
} from './name-match'
export {
  areGivenNamesEquivalent,
  canonicalGivenNames,
  type GivenNameMatchKind,
  givenNameEquivalence,
  NICKNAME_CANONICAL_COUNT,
  NICKNAME_NAME_COUNT,
  normalizeGivenName,
} from './nicknames'
export {
  type DismissPairParams,
  deleteOpenPairsForRecord,
  dismissPair,
  type MergeResolution,
  type RescorePairsParams,
  rescoreOpenPairsForRecord,
  resolveSuggestionsForMerge,
  upsertPairs,
} from './pairs'
export {
  type CountDuplicatePairsParams,
  countOpenDuplicatePairs,
  DUPLICATE_HIGH_INSTANCE_ID_SQL,
  DUPLICATE_LOW_INSTANCE_ID_SQL,
  type DuplicateCursor,
  type DuplicateDefScope,
  type DuplicatePair,
  type DuplicatePairListItem,
  type DuplicatePairPage,
  type DuplicateSide,
  type GetDuplicatePairParams,
  getVisibleDuplicatePair,
  type ListDuplicatePairsParams,
  type ListPairsForRecordParams,
  listDuplicatePairs,
  listDuplicatePairsForRecord,
  type MergeEstablishment,
  orderByEstablishment,
  readMergeEstablishment,
} from './queries'
export {
  bandForScore,
  type ScoredPair,
  scoreBlockGroup,
  scoreIdentityGroup,
  scorePair,
  scoreRecordMatches,
  scoreSignals,
  toCandidatePair,
} from './scoring'
export {
  type NameFieldIds,
  NORMALIZED_SURNAME_SQL,
  readStructuredNames,
  resolveNameFieldIds,
  type SurnameRarity,
  surnameIdf,
} from './surname-rarity'
export type {
  Band,
  CandidatePair,
  DedupConfig,
  DuplicateStatus,
  Signal,
  SignalStrength,
  SignalType,
} from './types'
