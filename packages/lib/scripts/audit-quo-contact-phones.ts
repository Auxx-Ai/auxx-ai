// packages/lib/scripts/audit-quo-contact-phones.ts
// Diagnostic: crawl every Quo contact the way the connector does and report which phone
// numbers libphonenumber would REJECT — i.e. which ones the sink's identity-match lookup
// will call an "uncoercible value". Read-only; prints numbers, never the API key.
//
// usage: npx dotenv -- npx tsx packages/lib/scripts/audit-quo-contact-phones.ts <credentialId> <organizationId>

import { resolveConnectionForRuntime } from '../src/connections/resolve-connection-for-runtime'
import { fieldValueSchemas } from '../src/field-values/field-value-validator'

const [credentialId, organizationId] = process.argv.slice(2)
if (!credentialId || !organizationId) {
  console.error('usage: audit-quo-contact-phones.ts <credentialId> <organizationId>')
  process.exit(1)
}

const resolved = await resolveConnectionForRuntime({
  connectionId: credentialId,
  organizationId,
  userId: 'system',
})
if (resolved.isErr()) {
  console.error('resolve failed:', resolved.error)
  process.exit(1)
}
const conn = resolved.value.organizationConnection ?? resolved.value.userConnection
const apiKey = conn?.fields?.apiKey
if (!apiKey) {
  console.error('no apiKey on the resolved connection')
  process.exit(1)
}

interface QuoContact {
  id: string
  defaultFields?: {
    firstName?: string | null
    lastName?: string | null
    phoneNumbers?: Array<{ value?: string | null }> | null
  } | null
}

const all: QuoContact[] = []
let pageToken: string | undefined
do {
  const url = new URL('https://api.quo.com/v1/contacts')
  url.searchParams.set('maxResults', '50')
  if (pageToken) url.searchParams.set('pageToken', pageToken)
  const res = await fetch(url, { headers: { Authorization: apiKey, Accept: 'application/json' } })
  if (!res.ok) {
    console.error('fetch failed', res.status, await res.text())
    process.exit(1)
  }
  const body = (await res.json()) as { data?: QuoContact[]; nextPageToken?: string }
  all.push(...(body.data ?? []))
  pageToken = body.nextPageToken
} while (pageToken)

let withPhone = 0
let rejected = 0
console.log(`contacts: ${all.length}`)
for (const c of all) {
  const name = [c.defaultFields?.firstName, c.defaultFields?.lastName].filter(Boolean).join(' ')
  for (const p of c.defaultFields?.phoneNumbers ?? []) {
    const raw = p?.value ?? ''
    if (!raw) continue
    withPhone++
    const parsed = fieldValueSchemas.phone.safeParse(raw)
    if (!parsed.success) {
      rejected++
      console.log(
        `REJECTED  ${JSON.stringify(raw)}  digits=${raw.replace(/\D/g, '').length}  ${name || '(no name)'}  id=${c.id}`
      )
    } else if (parsed.data !== raw) {
      console.log(`renormalized  ${JSON.stringify(raw)} -> ${JSON.stringify(parsed.data)}  ${name}`)
    }
  }
}
console.log(`\nphone values: ${withPhone} · rejected by libphonenumber: ${rejected}`)
process.exit(0)
