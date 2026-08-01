// packages/utils/src/index.ts

// Array utilities
export { uniqueBy } from './arrays'
// Browser utilities
export { IS_MAC_SCRIPT, isMac } from './browser'
// Calc expression utilities
export {
  CALC_FUNCTIONS,
  type CalcFunction,
  evaluateCalcExpression,
  getAvailableFunctions,
  type ParsedExpression,
  validateCalcExpression,
} from './calc-expression'
// Comment utilities
export { getGroupPosition, groupConsecutiveComments } from './comments'
// Contact utilities
export {
  type ContactName,
  formatCityName,
  formatCompanyName,
  formatComplexName,
  formatPhoneNumber,
  formatStreetAddress,
  getContactDisplayName,
  getFullName,
  getInitials,
  getInitialsFromName,
} from './contact'
// Counter utilities
export { createCounter, createIdAllocator } from './counter'
// CSV serialization (framework-agnostic; browser download lives in apps/web)
export { csvCell, toCsv } from './csv'
// Currency utilities
export {
  type CurrencyDisplayOptions,
  centsToDollars,
  convertToCents,
  formatCurrency,
  formatCurrencyCompact,
  parseToCents,
} from './currency'
// Date utilities
export {
  formatInTimezone,
  formatRelativeTime,
  formatRelativeTimeWithTimezone,
  formatTimeOfDay,
  getCurrentTimeInTimezone,
  getEndOfWeek,
  getStartOfWeek,
  isSameWeek,
  parseTimeOfDay,
} from './date'

// Email utilities
export {
  buildGraphFileAttachment,
  buildThreadingHeaders,
  emailsAreEquivalent,
  encodeEmailHeader,
  extractDomainFromEmail,
  extractEmailAddress,
  extractNameFromHeader,
  formatEmail,
  formatEmailAddress,
  formatEmailList,
  htmlToPlainText,
  isUserEmail,
  isValidEmail,
  normalizeEmail,
  normalizeMessageId,
  parseEmailString,
  sanitizeHeaderValue,
  toGraphRecipients,
  validateSendAsAddress,
} from './email'
// Error utilities
export { getErrorMessage, toError } from './errors'

// File utilities
export {
  calculateBase64Size,
  canPreviewInline,
  formatBytes,
  getAttachmentByteSize,
  getDirectoryPath,
  getFileCategory,
  getFileExtension,
  getFilenameFromPath,
  getMimeTypeFromExtension,
  getStandardFileType,
  isImageFile,
  isPreviewableImage,
  sanitizeFilename,
  validateAttachmentSizes,
} from './file'

// Fractional indexing utilities
export {
  BASE_62_DIGITS,
  generateKeyBetween,
  generateNKeysBetween,
  getSmartSortPositions,
  isValidOrderKey,
  nextKeyAfter,
  nKeysAfter,
  type SmartSortItem,
  type SmartSortResult,
} from './fractional-indexing'

// Function utilities
export { debounce, throttle } from './functions'

// ID generation
export { generateId } from './generateId'

// Header utilities
export { filterSensitiveHeaders } from './headers'

// MIME utilities
export {
  encodeBase64WithLineBreaks,
  encodeQuotedPrintable,
  encodeRFC2231Filename,
  ensureCRLF,
  foldMimeHeader,
  generateMimeBoundary,
  parseMultipartMixedResponse,
  validateLineLengths,
  validateMimeStructure,
} from './mime'
// Number utilities
export { formatNumberCompact } from './number'
// OAuth utilities
export { validateRedirectPath } from './oauth'
// Object utilities
export { cloneDeep, deepMerge, getByPath, isEmpty } from './objects'
// Parse utilities
export { parseBoolean, toNumeric } from './parse'
// Relationship utilities
export {
  getInverseCardinality,
  isMultiRelationship,
  isSingleRelationship,
  type RelationshipType,
} from './relationships'
// Retry utilities
export { withRetry } from './retry'
// String utilities
export {
  humanizeFieldName,
  humanizeFieldPath,
  incrementTitle,
  interpretEscapeSequences,
  pluralize,
  removeExcessiveWhitespace,
  titleize,
} from './strings'
// Task date utilities
export {
  addDays,
  addMonths,
  addYears,
  calculateDuration,
  calculateEndOfMonth,
  calculateNextQuarter,
  calculateTargetDate,
  calculateTargetDateInTimezone,
  formatAbsoluteDate,
  formatRelativeDate,
  formatTimeRemaining,
} from './task-date'
// Timezone utilities (re-export everything)
export * from './timezone'
// URL utilities
export {
  type AuxxArticleRef,
  buildAuxxArticleUrl,
  deriveTitleFromUrl,
  formatUrlForDisplay,
  interpolateTemplate,
  isAuxxUrl,
  isLikelyUrlInput,
  normalizeUrl,
  parseAuxxArticleUrl,
  unresolvedPlaceholders,
} from './url'
