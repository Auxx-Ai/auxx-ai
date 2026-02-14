// packages/lib/src/import/fields/auto-map-columns.ts

import type { ResolutionType } from '../types/resolution'
import type { ImportableField } from './get-importable-fields'
import { suggestResolutionType } from './suggest-resolution-type'

/** Column header from CSV */
export interface ColumnHeader {
  index: number
  name: string
}

/** Auto-mapping result for a column */
export interface ColumnAutoMapping {
  columnIndex: number
  columnName: string
  matchedField: ImportableField | null
  resolutionType: ResolutionType
  confidence: number // 0-1, how confident we are in this match
}

/**
 * Split a string into words, handling camelCase, snake_case, kebab-case, and spaces.
 */
function splitIntoWords(str: string): string[] {
  return (
    str
      // Insert space before uppercase letters (camelCase)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      // Replace separators with spaces
      .replace(/[_-]/g, ' ')
      // Split on spaces and filter empty
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0)
  )
}

/**
 * Normalize a string for comparison:
 * - lowercase
 * - remove underscores, dashes, spaces
 * - remove common prefixes/suffixes
 */
function normalizeForComparison(str: string): string {
  return str
    .toLowerCase()
    .replace(/[_\-\s]/g, '')
    .replace(/^(col|column|field)/, '')
    .replace(/(id|field|col|column)$/, '')
}

/**
 * Calculate word-based similarity between two strings.
 * Handles camelCase, snake_case, and compound names.
 */
function wordSimilarity(a: string, b: string): number {
  const wordsA = splitIntoWords(a)
  const wordsB = splitIntoWords(b)

  if (wordsA.length === 0 || wordsB.length === 0) return 0

  // Check for exact word match (after normalization)
  const normA = normalizeForComparison(a)
  const normB = normalizeForComparison(b)
  if (normA === normB) return 1

  // Count matching words
  let matchingWords = 0
  let totalWeight = 0

  for (const wordA of wordsA) {
    // First word is often more important (e.g., "first" in "firstName")
    const weight = wordA === wordsA[0] ? 2 : 1
    totalWeight += weight

    for (const wordB of wordsB) {
      if (wordA === wordB) {
        matchingWords += weight
        break
      }
      // Partial match for similar words
      if (wordA.length > 2 && wordB.length > 2) {
        if (wordA.startsWith(wordB) || wordB.startsWith(wordA)) {
          matchingWords += weight * 0.8
          break
        }
      }
    }
  }

  // Also check if normalized strings are contained
  if (normA.includes(normB) || normB.includes(normA)) {
    return Math.max(0.7, matchingWords / totalWeight)
  }

  return matchingWords / totalWeight
}

/**
 * Common aliases for field names
 */
const FIELD_ALIASES: Record<string, string[]> = {
  email: ['email', 'emailaddress', 'mail', 'e-mail', 'emailaddr'],
  firstName: ['firstname', 'first', 'fname', 'givenname', 'forename'],
  lastName: ['lastname', 'last', 'lname', 'surname', 'familyname', 'family'],
  name: ['name', 'fullname', 'displayname', 'contactname'],
  phone: ['phone', 'phonenumber', 'mobile', 'cell', 'telephone', 'tel', 'cellphone'],
  address: ['address', 'streetaddress', 'street', 'address1', 'addressline1'],
  address2: ['address2', 'addressline2', 'apt', 'suite', 'unit'],
  city: ['city', 'town', 'locality'],
  state: ['state', 'province', 'region', 'stateprovince'],
  country: ['country', 'countrycode', 'nation'],
  zip: ['zip', 'zipcode', 'postalcode', 'postcode', 'postal'],
  company: ['company', 'companyname', 'organization', 'org', 'business', 'employer'],
  title: ['title', 'jobtitle', 'position', 'role', 'job'],
  notes: ['notes', 'note', 'comments', 'comment', 'description', 'memo', 'remarks'],
  createdAt: ['createdat', 'created', 'datecreated', 'creationdate', 'createdon'],
  updatedAt: ['updatedat', 'updated', 'datemodified', 'modifieddate', 'modifiedon'],
  externalId: ['externalid', 'external_id', 'extid', 'customerid', 'clientid', 'refid'],
}

/** Match result with score for sorting */
interface MatchCandidate {
  headerIndex: number
  field: ImportableField
  confidence: number
}

/**
 * Auto-map CSV column headers to resource fields.
 * Uses a two-pass approach: exact/alias matches first, then word similarity.
 *
 * @param headers - Array of column headers
 * @param fields - Array of importable fields
 * @returns Array of auto-mapping results
 */
export function autoMapColumns(
  headers: ColumnHeader[],
  fields: ImportableField[]
): ColumnAutoMapping[] {
  const results: ColumnAutoMapping[] = headers.map((h) => ({
    columnIndex: h.index,
    columnName: h.name,
    matchedField: null,
    resolutionType: 'text:value' as ResolutionType,
    confidence: 0,
  }))

  const usedFields = new Set<string>()
  const matchedHeaders = new Set<number>()

  // Pass 1: Find exact and alias matches (high confidence)
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]!
    const normalizedHeader = normalizeForComparison(header.name)

    for (const field of fields) {
      if (usedFields.has(field.key)) continue

      // Check exact match with field key
      if (normalizedHeader === normalizeForComparison(field.key)) {
        results[i]!.matchedField = field
        results[i]!.confidence = 1
        results[i]!.resolutionType = suggestResolutionType(field)
        usedFields.add(field.key)
        matchedHeaders.add(i)
        break
      }

      // Check aliases
      const aliases = FIELD_ALIASES[field.key]
      if (aliases) {
        for (const alias of aliases) {
          if (normalizedHeader === alias.replace(/[_\-\s]/g, '').toLowerCase()) {
            results[i]!.matchedField = field
            results[i]!.confidence = 0.95
            results[i]!.resolutionType = suggestResolutionType(field)
            usedFields.add(field.key)
            matchedHeaders.add(i)
            break
          }
        }
      }

      if (matchedHeaders.has(i)) break
    }
  }

  // Pass 2: Find best similarity matches for remaining columns
  // Collect all candidates and sort by confidence to get global best matches
  const candidates: MatchCandidate[] = []

  for (let i = 0; i < headers.length; i++) {
    if (matchedHeaders.has(i)) continue

    const header = headers[i]!

    for (const field of fields) {
      if (usedFields.has(field.key)) continue

      // Calculate word-based similarity
      const keySimilarity = wordSimilarity(header.name, field.key)
      const labelSimilarity = wordSimilarity(header.name, field.label)
      const similarity = Math.max(keySimilarity, labelSimilarity)

      // Only consider matches above threshold
      if (similarity >= 0.5) {
        candidates.push({
          headerIndex: i,
          field,
          confidence: similarity,
        })
      }
    }
  }

  // Sort by confidence (highest first) and assign greedily
  candidates.sort((a, b) => b.confidence - a.confidence)

  for (const candidate of candidates) {
    if (matchedHeaders.has(candidate.headerIndex)) continue
    if (usedFields.has(candidate.field.key)) continue

    results[candidate.headerIndex]!.matchedField = candidate.field
    results[candidate.headerIndex]!.confidence = candidate.confidence
    results[candidate.headerIndex]!.resolutionType = suggestResolutionType(candidate.field)
    usedFields.add(candidate.field.key)
    matchedHeaders.add(candidate.headerIndex)
  }

  return results
}
