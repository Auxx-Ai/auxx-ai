// packages/lib/scripts/probe-quo-connector-auth.ts
// Diagnostic: resolve the Quo data-connector's bound credential exactly as
// `connector-runtime.prepareConnectorFetch` does, show what `applyAuth` would put on
// the wire, and hit `/v1/contacts` with it. Values are masked — the key is never printed.
//
// usage: npx dotenv -- npx tsx packages/lib/scripts/probe-quo-connector-auth.ts <credentialId> <organizationId>

import { applyAuth } from '../src/connections/auth-apply'
import { resolveConnectionForRuntime } from '../src/connections/resolve-connection-for-runtime'

const [credentialId, organizationId] = process.argv.slice(2)
if (!credentialId || !organizationId) {
  console.error('usage: probe-quo-connector-auth.ts <credentialId> <organizationId>')
  process.exit(1)
}

function mask(s: string): string {
  return s ? `${s.slice(0, 3)}…(${s.length} chars)` : '<EMPTY>'
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
if (!conn) {
  console.error('no connection returned')
  process.exit(1)
}

console.log('resolved .value      :', mask(conn.value))
console.log('resolved .fields keys:', Object.keys(conn.fields ?? {}))
console.log('authApply            :', JSON.stringify(conn.authApply))

const req = applyAuth(
  { headers: {}, url: 'https://api.quo.com/v1/contacts' },
  { value: conn.value, fields: conn.fields },
  conn.authApply
)
console.log('Authorization header :', mask(req.headers.Authorization ?? ''))

const res = await fetch('https://api.quo.com/v1/contacts?maxResults=1', {
  headers: { ...req.headers, Accept: 'application/json' },
})
console.log('live status          :', res.status)
console.log('live body            :', (await res.text()).slice(0, 400))
process.exit(0)
