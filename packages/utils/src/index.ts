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
// Currency utilities
export {
  type CurrencyDisplayOptions,
  centsToDollars,
  convertToCents,
  formatCurrency,
  parseToCents,
} from './currency'
// Date utilities
export {
  formatInTimezone,
  formatRelativeTime,
  formatRelativeTimeWithTimezone,
  getCurrentTimeInTimezone,
  getEndOfWeek,
  getStartOfWeek,
  isSameWeek,
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

// File utilities
export {
  calculateBase64Size,
  formatBytes,
  getAttachmentByteSize,
  getDirectoryPath,
  getFileExtension,
  getFilenameFromPath,
  getMimeTypeFromExtension,
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
  type SmartSortItem,
  type SmartSortResult,
} from './fractional-indexing'

// Function utilities
export { debounce } from './functions'

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

// Object utilities
export { cloneDeep, deepMerge, getByPath } from './objects'

// Parse utilities
export { parseBoolean } from './parse'
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
