# @auxx/utils

Shared utility functions for the Auxx.ai platform.

## Installation

This is an internal workspace package. It's automatically available to other packages via pnpm workspace dependencies:

```json
{
  "dependencies": {
    "@auxx/utils": "workspace:*"
  }
}
```

## Usage

Import utilities from the barrel export or specific modules:

```typescript
// Barrel import - all utilities
import { formatCurrency, generateId, formatBytes } from '@auxx/utils'

// Specific module import (recommended for better tree-shaking)
import { formatCurrency } from '@auxx/utils/currency'
import { generateId } from '@auxx/utils/generateId'
```

## Available Modules

### Arrays
- `uniqueBy` - Get unique array items by a property

### Comments
- `groupConsecutiveComments` - Group consecutive comments together
- `getGroupPosition` - Get the position of a comment group

### Contact
- `getFullName` - Get full name from first/last name
- `getContactDisplayName` - Get displayable contact name
- `getInitials` - Get initials from a full name
- `getInitialsFromName` - Get initials from first/last name
- `formatPhoneNumber` - Format phone number for display
- `formatStreetAddress` - Format street address
- `formatCompanyName` - Format company name
- `formatComplexName` - Format complex name formats
- `formatCityName` - Format city name

### Currency
- `formatCurrency` - Format cents to currency display string
- `parseToCents` - Parse display value to cents
- `centsToDollars` - Convert cents to dollars for input display
- `convertToCents` - Convert price string to cents

### Date
- `formatRelativeTime` - Format date as relative time ("2 hours ago")
- `isSameWeek` - Check if two dates are in the same week
- `getStartOfWeek` - Get the start of a week
- `getEndOfWeek` - Get the end of a week
- `formatInTimezone` - Format date in specific timezone
- `formatRelativeTimeWithTimezone` - Format relative time with timezone
- `getCurrentTimeInTimezone` - Get current time in a timezone

### Email
- `parseEmailString` - Parse email address string
- `formatEmailAddress` - Format email address for display
- `extractDomainFromEmail` - Extract domain from email
- `extractEmailAddress` - Extract email address from string
- `formatEmail` - Format email for display
- `normalizeEmail` - Normalize email address
- `isUserEmail` - Check if email is a user email
- `extractNameFromHeader` - Extract name from email header
- `isValidEmail` - Validate email address
- `emailsAreEquivalent` - Check if two emails are equivalent
- `normalizeMessageId` - Normalize email message ID
- `htmlToPlainText` - Convert HTML to plain text
- `formatEmailList` - Format list of emails
- `encodeEmailHeader` - Encode email header
- `validateSendAsAddress` - Validate send-as address
- `sanitizeHeaderValue` - Sanitize email header value
- `buildThreadingHeaders` - Build email threading headers
- `toGraphRecipients` - Convert to Microsoft Graph recipients
- `buildGraphFileAttachment` - Build Microsoft Graph file attachment

### File
- `formatBytes` - Format bytes to human-readable string (e.g., "1.5 MB")
- `getFileExtension` - Get file extension from filename
- `getDirectoryPath` - Get directory path from file path
- `isImageFile` - Check if file is an image
- `isPreviewableImage` - Check if image can be previewed
- `sanitizeFilename` - Sanitize filename for safe storage
- `calculateBase64Size` - Calculate size of base64 data
- `validateAttachmentSizes` - Validate attachment sizes
- `getMimeTypeFromExtension` - Get MIME type from file extension
- `getAttachmentByteSize` - Get attachment byte size
- `getFilenameFromPath` - Get filename from file path

### Fractional Indexing
- `generateKeyBetween` - Generate a sort key between two keys
- `generateNKeysBetween` - Generate N sort keys between two keys
- `BASE_62_DIGITS` - Base-62 digit characters
- `getSmartSortPositions` - Get sort positions for items

### Functions
- `debounce` - Debounce function calls

### ID Generation
- `generateId` - Generate unique ID (uses nanoid)

### Headers
- `filterSensitiveHeaders` - Filter sensitive HTTP headers

### MIME
- `foldMimeHeader` - Fold MIME header for long values
- `encodeRFC2231Filename` - Encode filename with RFC2231
- `encodeQuotedPrintable` - Encode text as quoted-printable
- `encodeBase64WithLineBreaks` - Encode as base64 with line breaks
- `generateMimeBoundary` - Generate MIME boundary string
- `validateMimeStructure` - Validate MIME structure
- `ensureCRLF` - Ensure CRLF line endings
- `parseMultipartMixedResponse` - Parse multipart MIME response
- `validateLineLengths` - Validate email line lengths

### Objects
- `cloneDeep` - Deep clone an object
- `getByPath` - Get object property by path
- `deepMerge` - Deep merge objects

### Parse
- `parseBoolean` - Parse string to boolean

### Retry
- `withRetry` - Retry async function with exponential backoff

### Strings
- `titleize` - Convert to title case
- `removeExcessiveWhitespace` - Remove extra whitespace
- `pluralize` - Pluralize word
- `interpretEscapeSequences` - Interpret escape sequences
- `incrementTitle` - Increment title number

### Timezone
- All timezone utilities from `date-fns-tz`

## Testing

```bash
# Run tests
pnpm -F @auxx/utils test

# Run tests with coverage
pnpm -F @auxx/utils test:coverage
```

## Type Checking

```bash
pnpm -F @auxx/utils typecheck
```

## Architecture

This package was created to:
1. Provide a lightweight, focused utilities package
2. Break the circular dependency between `@auxx/lib` and `@auxx/services`
3. Make utilities available across all packages without dependency conflicts
4. Reduce the complexity of `@auxx/lib` by separating concerns

The utilities are:
- **Stateless**: All functions are pure utilities with no side effects
- **Zero-dependency**: No dependencies on `@auxx/lib`, `@auxx/services`, or `@auxx/database`
- **Type-safe**: Full TypeScript support with proper exports
- **Well-tested**: Inherited test coverage from `@auxx/lib`
