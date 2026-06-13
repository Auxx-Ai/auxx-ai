// scripts/ups-oauth-probe.ts
//
// Empirical probe for UPS OAuth refresh behavior — resolves the gating open question
// for plans/apps/oauth/app-connection-lazy-refresh-plan.md §4 (and UPS plan §3):
//
//   Does /security/v1/oauth/token accept grant_type=refresh_token,
//   or is /security/v1/oauth/refresh a mandatory separate endpoint?
//
// We only have a client_id/secret (no user refresh token yet), so we cannot run the
// full auth-code roundtrip. Instead we:
//   A. client_credentials → /oauth/token : confirms creds + which env they belong to.
//   B. refresh_token (dummy) → /oauth/token : read the error code.
//        - "unsupported_grant_type" / 400 grant rejected  → token URL does NOT do refresh → OVERRIDE REQUIRED
//        - "invalid_grant" / bad-refresh-token error       → grant accepted, token just invalid → override NOT needed
//   C. refresh_token (dummy) → /oauth/refresh : confirms the dedicated endpoint exists
//        and accepts the grant (expect invalid-refresh-token, NOT 404 / unsupported_grant_type).
//
// Run (loads root .env, incl. multiline values):
//   npx dotenv -- npx tsx scripts/ups-oauth-probe.ts
// Optional: UPS_ENV=cie to test wwwcie only, UPS_ENV=prod for onlinetools only (default: both).

const CLIENT_ID = process.env.UPS_CLIENT_ID
const CLIENT_SECRET = process.env.UPS_SECRET

const BASES: Record<string, string> = {
  prod: 'https://onlinetools.ups.com',
  cie: 'https://wwwcie.ups.com',
}

function basicAuth(): string {
  return Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
}

type ProbeResult = {
  status: number
  ok: boolean
  errorCode?: string
  errorMessage?: string
  raw: string
}

async function post(url: string, body: Record<string, string>): Promise<ProbeResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth()}`,
      Accept: 'application/json',
    },
    body: new URLSearchParams(body).toString(),
  })
  const raw = await res.text()
  let errorCode: string | undefined
  let errorMessage: string | undefined
  try {
    const json = JSON.parse(raw)
    const err = json?.response?.errors?.[0]
    if (err) {
      errorCode = err.code
      errorMessage = err.message
    }
  } catch {
    // non-JSON body — keep raw
  }
  return { status: res.status, ok: res.ok, errorCode, errorMessage, raw }
}

function summarize(r: ProbeResult): string {
  const code = r.errorCode ? ` code=${r.errorCode}` : ''
  const msg = r.errorMessage ? ` "${r.errorMessage}"` : ''
  const body = !r.errorCode ? ` body=${r.raw.slice(0, 160)}` : ''
  return `HTTP ${r.status}${code}${msg}${body}`
}

async function probeEnv(name: string, base: string): Promise<void> {
  console.log(`\n========== ${name.toUpperCase()}  (${base}) ==========`)

  // A. client_credentials — sanity: are the creds valid here?
  const tokenUrl = `${base}/security/v1/oauth/token`
  const refreshUrl = `${base}/security/v1/oauth/refresh`

  console.log(`\n[A] client_credentials → ${tokenUrl}`)
  const a = await post(tokenUrl, { grant_type: 'client_credentials' })
  console.log('    ', summarize(a))
  if (a.ok) {
    try {
      const tok = JSON.parse(a.raw)
      console.log(
        `     ✓ creds valid in ${name}. expires_in=${tok.expires_in}s token_type=${tok.token_type}`
      )
    } catch {}
  } else if (a.status === 401) {
    console.log(`     ✗ creds NOT valid in ${name} (401). Likely belong to the other environment.`)
  }

  // B. refresh grant against the TOKEN url with a dummy refresh token.
  console.log(
    `\n[B] refresh_token (dummy) → ${tokenUrl}   [does token URL accept the refresh grant?]`
  )
  const b = await post(tokenUrl, {
    grant_type: 'refresh_token',
    refresh_token: 'dummy-invalid-token',
  })
  console.log('    ', summarize(b))

  // C. refresh grant against the dedicated REFRESH url with a dummy refresh token.
  console.log(`\n[C] refresh_token (dummy) → ${refreshUrl}   [does the dedicated endpoint exist?]`)
  const c = await post(refreshUrl, {
    grant_type: 'refresh_token',
    refresh_token: 'dummy-invalid-token',
  })
  console.log('    ', summarize(c))

  // Verdict
  console.log(`\n--- verdict (${name}) ---`)
  const tokenAcceptsRefresh = interpretsGrantAsAccepted(b)
  const refreshEndpointWorks = interpretsGrantAsAccepted(c)
  console.log(`    token URL accepts refresh grant?   ${describe(b, tokenAcceptsRefresh)}`)
  console.log(`    /oauth/refresh accepts refresh?    ${describe(c, refreshEndpointWorks)}`)
  if (tokenAcceptsRefresh) {
    console.log(`    => Override NOT required: refresh works against the token URL too.`)
  } else if (refreshEndpointWorks) {
    console.log(`    => Override REQUIRED: refresh only works at /oauth/refresh (§4 must land).`)
  } else {
    console.log(
      `    => Inconclusive — inspect raw bodies above (creds may be invalid in this env).`
    )
  }
}

// "accepted" = the endpoint processed the refresh grant and rejected only because the
// dummy refresh token is invalid (invalid_grant / invalid token). It did NOT reject the
// grant *type* itself, and it is not a 404 / unsupported_grant_type.
function interpretsGrantAsAccepted(r: ProbeResult): boolean | null {
  if (r.status === 404) return false
  const blob = `${r.errorCode ?? ''} ${r.errorMessage ?? ''} ${r.raw}`.toLowerCase()
  if (blob.includes('unsupported_grant_type') || blob.includes('grant type')) return false
  if (
    blob.includes('invalid_grant') ||
    blob.includes('invalid refresh') ||
    blob.includes('refresh token') ||
    blob.includes('invalid token')
  ) {
    return true
  }
  return null // unknown — needs human read
}

function describe(r: ProbeResult, accepted: boolean | null): string {
  if (accepted === true) return 'YES (grant accepted, only the dummy token was rejected)'
  if (accepted === false)
    return r.status === 404 ? 'NO (404 — endpoint not found)' : 'NO (grant type rejected)'
  return 'UNKNOWN (read raw body)'
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Missing UPS_CLIENT_ID and/or UPS_SECRET in env.')
    console.error('Run with: npx dotenv -- npx tsx scripts/ups-oauth-probe.ts')
    process.exit(1)
  }

  console.log(
    `UPS OAuth refresh probe — client_id=${CLIENT_ID.slice(0, 6)}…(${CLIENT_ID.length} chars)`
  )

  const envArg = (process.env.UPS_ENV ?? '').toLowerCase()
  const envs = envArg === 'prod' || envArg === 'cie' ? [envArg] : ['prod', 'cie']

  for (const name of envs) {
    try {
      await probeEnv(name, BASES[name])
    } catch (err) {
      console.error(`\n[${name}] probe threw:`, err instanceof Error ? err.message : err)
    }
  }

  console.log('\nDone.')
}

main()
