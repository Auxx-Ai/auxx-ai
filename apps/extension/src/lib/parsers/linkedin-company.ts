// apps/extension/src/lib/parsers/linkedin-company.ts

/**
 * LinkedIn company profile parser.
 *
 * Primary path: Voyager's `voyagerOrganizationDashCompaniesByUniversalName`
 * GraphQL endpoint. Supports both response shapes LinkedIn has shipped:
 *   1. Inline: `data.organizationDashCompaniesByUniversalName.elements[0]`
 *      is the company object itself.
 *   2. URN-referenced: `data.data.X.*elements[0]` is a URN string that
 *      resolves to an entry in the top-level `included[]` array.
 *
 * Fallback: if Voyager fails (CSRF gone, endpoint hash rotated, schema
 * drift), we DOM-scrape name + logo + slug so the save flow can still
 * work with reduced data.
 *
 * Works on `https://www.linkedin.com/company/<slug>/...` URLs.
 */

import { z } from 'zod'
import { linkedInCompanyExternalId } from '../external-id'
import { voyagerFetch } from '../voyager'
import { EMPTY_PARSE_RESULT, type ParsedCompany, type ParseResult } from './types'

// ─── Voyager company shape ────────────────────────────────────

const VectorImageSchema = z
  .object({
    artifacts: z.array(
      z.object({
        width: z.number().nullable().optional(),
        height: z.number().nullable().optional(),
        fileIdentifyingUrlPathSegment: z.string().nullable().optional(),
      })
    ),
    rootUrl: z.string().nullable().optional(),
  })
  .nullable()
  .optional()
type VectorImage = z.infer<typeof VectorImageSchema>

const CompanySchema = z
  .object({
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    websiteUrl: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    phone: z.object({ number: z.string().nullable().optional() }).nullable().optional(),
    logoResolutionResult: z.object({ vectorImage: VectorImageSchema }).nullable().optional(),
    logo: z.object({ vectorImage: VectorImageSchema }).nullable().optional(),
  })
  .passthrough()
type Company = z.infer<typeof CompanySchema>

// Envelope schema — permissive. We pick the company out of whichever shape
// came back: inline `elements[0]` or `*elements[0]` as a URN + `included[]`.
const VoyagerEnvelopeSchema = z
  .object({
    data: z.unknown().optional(),
    included: z.array(z.unknown()).optional(),
  })
  .passthrough()

// ─── Helpers ──────────────────────────────────────────────────

function extractPicture(vi: VectorImage): string | undefined {
  if (!vi?.artifacts || !vi.rootUrl) return undefined
  const artifact = vi.artifacts.find((a) => a.width === 200) ?? vi.artifacts[0]
  if (!artifact?.fileIdentifyingUrlPathSegment) return undefined
  return `${vi.rootUrl}${artifact.fileIdentifyingUrlPathSegment}`
}

function normalizeDomain(raw: string): string {
  const trimmed = raw.trim()
  try {
    const u = new URL(
      trimmed.startsWith('http:') || trimmed.startsWith('https:') ? trimmed : `https://${trimmed}`
    )
    const path = u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname
    return `${u.hostname}${path}${u.search}${u.hash}`
  } catch {
    return trimmed
  }
}

function dedupe(values: Array<string | null | undefined>): string[] {
  return values.reduce<string[]>((acc, raw) => {
    const trimmed = raw?.trim()
    if (trimmed && !acc.includes(trimmed)) acc.push(trimmed)
    return acc
  }, [])
}

function slugFromUrl(url: URL): string | null {
  const m = url.pathname.match(/\/company\/([^/?#]+)/)
  return m?.[1] ?? null
}

/**
 * Walk the envelope and return the first Company we can find. Handles:
 *   - `data.X.elements[0]` inline object
 *   - `data.data.X.elements[0]` inline object (newer nesting)
 *   - `data.X['*elements'][0]` as URN → look up `included[]` by `entityUrn`
 */
function pickCompany(envelope: unknown): Company | undefined {
  if (!envelope || typeof envelope !== 'object') return undefined
  const env = envelope as Record<string, unknown>
  const included = Array.isArray(env.included)
    ? (env.included as Array<Record<string, unknown>>)
    : []

  // Candidate data roots. LinkedIn has nested `data.data.X` on newer releases.
  const dataRoots: Array<Record<string, unknown>> = []
  if (env.data && typeof env.data === 'object') {
    dataRoots.push(env.data as Record<string, unknown>)
    const nested = (env.data as Record<string, unknown>).data
    if (nested && typeof nested === 'object') {
      dataRoots.push(nested as Record<string, unknown>)
    }
  }

  for (const root of dataRoots) {
    const node = root.organizationDashCompaniesByUniversalName
    if (!node || typeof node !== 'object') continue
    const n = node as Record<string, unknown>

    // Inline shape
    if (Array.isArray(n.elements) && n.elements[0]) {
      const parsed = CompanySchema.safeParse(n.elements[0])
      if (parsed.success) return parsed.data
    }

    // URN-referenced shape
    const refs = n['*elements']
    if (Array.isArray(refs) && typeof refs[0] === 'string') {
      const urn = refs[0] as string
      const hit = included.find((inc) => inc && (inc as { entityUrn?: unknown }).entityUrn === urn)
      if (hit) {
        const parsed = CompanySchema.safeParse(hit)
        if (parsed.success) return parsed.data
      }
    }
  }

  // Last-ditch scan of `included[]` for a Company entity — LinkedIn
  // sometimes drops the outer envelope entirely.
  for (const inc of included) {
    if (!inc || typeof inc !== 'object') continue
    const t = (inc as { $type?: unknown }).$type
    if (typeof t === 'string' && t.toLowerCase().includes('organization.company')) {
      const parsed = CompanySchema.safeParse(inc)
      if (parsed.success) return parsed.data
    }
  }
  return undefined
}

// ─── DOM fallback ─────────────────────────────────────────────

function parseFromDom(slug: string): ParsedCompany | null {
  // Name: top-card h1 first, then document.title cleanup.
  const headings = document.querySelectorAll<HTMLElement>('main h1')
  let name: string | undefined
  for (const h of headings) {
    const t = h.textContent?.trim()
    if (t) {
      name = t
      break
    }
  }
  if (!name) {
    // "Auxx | LinkedIn" → "Auxx"
    const title = document.title.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim()
    if (title) name = title
  }

  // Logo: pick the first company avatar on the page.
  const logoImg = document.querySelector<HTMLImageElement>(
    'main img.org-top-card-primary-content__logo, main img[alt*="logo" i], main section img'
  )
  const avatarUrl = logoImg?.src || undefined

  if (!name) return null
  return {
    name,
    avatarUrl,
    externalId: linkedInCompanyExternalId(slug),
  }
}

// ─── Entry point ──────────────────────────────────────────────

const VOYAGER_URL = (slug: string): string =>
  `https://www.linkedin.com/voyager/api/graphql?variables=(universalName:${slug})&queryId=voyagerOrganizationDashCompaniesByUniversalName.1164a39ce57e74d426483681eeb51d02`

export async function parseLinkedInCompany(): Promise<ParseResult> {
  const slug = slugFromUrl(new URL(location.href))
  if (!slug) return EMPTY_PARSE_RESULT

  const envelope = await voyagerFetch(VOYAGER_URL(slug), VoyagerEnvelopeSchema)
  const company = envelope ? pickCompany(envelope) : undefined

  if (!company) {
    // Voyager failed or schema missed. Fall back to DOM so at least the
    // save flow renders the card with name + logo.
    const dom = parseFromDom(slug)
    if (!dom) return EMPTY_PARSE_RESULT
    console.info('[auxx] linkedin-company: DOM fallback used')
    return { people: [], companies: [dom] }
  }

  const urls = dedupe([company.url, company.websiteUrl])
  const picture = extractPicture(
    company.logoResolutionResult?.vectorImage ?? company.logo?.vectorImage
  )
  const phone = company.phone?.number?.trim()

  const notesParts: string[] = []
  if (company.description) notesParts.push(company.description)
  if (phone) notesParts.push(`Phone: ${phone}`)
  if (urls.length > 0) notesParts.push(`Links: ${urls.join(', ')}`)
  const notes = notesParts.join('\n\n') || undefined

  const parsed: ParsedCompany = {
    name: company.name ?? undefined,
    domain: company.websiteUrl ? normalizeDomain(company.websiteUrl) : undefined,
    avatarUrl: picture,
    notes,
    externalId: linkedInCompanyExternalId(slug),
  }

  return { people: [], companies: [parsed] }
}
