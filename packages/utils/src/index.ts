// packages/utils/src/index.ts

// Array utilities
export { uniqueBy } from './arrays'

// Comment utilities
export { groupConsecutiveComments, getGroupPosition } from './comments'

// Contact utilities
export {
  getFullName,
  getContactDisplayName,
  getInitials,
  getInitialsFromName,
  type ContactName,
  formatPhoneNumber,
  formatStreetAddress,
  formatCompanyName,
  formatComplexName,
  formatCityName,
} from './contact'

// Currency utilities
export {
  formatCurrency,
  parseToCents,
  centsToDollars,
  convertToCents,
  type CurrencyDisplayOptions,
} from './currency'

// Date utilities
export {
  formatRelativeTime,
  isSameWeek,
  getStartOfWeek,
  getEndOfWeek,
  formatInTimezone,
  formatRelativeTimeWithTimezone,
  getCurrentTimeInTimezone,
} from './date'

// Timezone utilities (re-export everything)
export * from './timezone'

// Email utilities
export {
  parseEmailString,
  formatEmailAddress,
  extractDomainFromEmail,
  extractEmailAddress,
  formatEmail,
  normalizeEmail,
  isUserEmail,
  extractNameFromHeader,
  isValidEmail,
  emailsAreEquivalent,
  normalizeMessageId,
  htmlToPlainText,
  formatEmailList,
  encodeEmailHeader,
  validateSendAsAddress,
  sanitizeHeaderValue,
  buildThreadingHeaders,
  toGraphRecipients,
  buildGraphFileAttachment,
} from './email'

// File utilities
export {
  formatBytes,
  getFileExtension,
  getDirectoryPath,
  isImageFile,
  isPreviewableImage,
  sanitizeFilename,
  calculateBase64Size,
  validateAttachmentSizes,
  getMimeTypeFromExtension,
  getAttachmentByteSize,
  getFilenameFromPath,
} from './file'

// Fractional indexing utilities
export {
  generateKeyBetween,
  generateNKeysBetween,
  BASE_62_DIGITS,
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
  foldMimeHeader,
  encodeRFC2231Filename,
  encodeQuotedPrintable,
  encodeBase64WithLineBreaks,
  generateMimeBoundary,
  validateMimeStructure,
  ensureCRLF,
  parseMultipartMixedResponse,
  validateLineLengths,
} from './mime'

// Object utilities
export { cloneDeep, getByPath, deepMerge } from './objects'

// Parse utilities
export { parseBoolean } from './parse'

// Retry utilities
export { withRetry } from './retry'

// Relationship utilities
export {
  getInverseCardinality,
  isSingleValueRelationship,
  type RelationshipType,
} from './relationships'

// String utilities
export {
  titleize,
  removeExcessiveWhitespace,
  pluralize,
  interpretEscapeSequences,
  incrementTitle,
} from './strings'

// Task date utilities
export {
  addDays,
  addMonths,
  addYears,
  calculateTargetDate,
  calculateTargetDateInTimezone,
  calculateEndOfMonth,
  calculateNextQuarter,
  calculateDuration,
  formatRelativeDate,
  formatTimeRemaining,
  formatAbsoluteDate,
} from './task-date'
