// apps/web/src/app/(protected)/preview/widget/[integrationId]/page.tsx
'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { useEnv } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'

type PreviewTheme = 'light' | 'dark' | 'system'
type BootMode = 'declarative' | 'programmatic'
type IdentityMode = 'anonymous' | 'identified'
type ExpiresIn = '30s' | '1m' | '1h' | '1d'

const THEME_LABELS: Record<PreviewTheme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

const ENFORCEMENT_LABELS: Record<'off' | 'in_progress' | 'enforced', string> = {
  off: 'Off',
  in_progress: 'In progress',
  enforced: 'Enforced',
}

/**
 * AttrEntry is one row of the simple key/value editor used for the sensitive
 * (JWT-claim) and non-sensitive (`Auxx.boot({ attributes })`) attribute bags
 * that the preview surface lets testers play with to exercise phase-4's
 * conflict resolution.
 */
interface AttrEntry {
  id: string
  key: string
  value: string
}

const nextId = (): string => Math.random().toString(36).slice(2, 10)

function attrsToObject(entries: AttrEntry[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const entry of entries) {
    const k = entry.key.trim()
    if (!k) continue
    out[k] = entry.value
  }
  return out
}

/**
 * Preview surface for the embedded chat widget. The widget HTML lives inside
 * an `<iframe srcDoc>` so the document the script attaches to has none of our
 * Tailwind preflight, Inter font, or provider tree — it looks like a
 * customer's vanilla page, which is the only way the preview is a real
 * smoke test ("if it renders here, it renders anywhere").
 *
 * v4 phase 6 expanded the toolbar to drive both boot modes (declarative
 * `<script>` and programmatic `Auxx.boot()`) and the JWT identity surface:
 * pick a `user_id`, sign a test JWT via `chat.signTestJwt`, boot the widget
 * with that JWT, and read back what the server resolved.
 */
export default function PreviewWidgetPage() {
  const params = useParams<{ integrationId: string }>()
  const search = useSearchParams()
  const { appUrl, apiUrl } = useEnv()
  const integrationId = params?.integrationId
  const v = search?.get('v') ?? null

  const [previewTheme, setPreviewTheme] = useState<PreviewTheme>('light')
  const [bootMode, setBootMode] = useState<BootMode>('declarative')
  const [identityMode, setIdentityMode] = useState<IdentityMode>('anonymous')
  const [userId, setUserId] = useState(() => `preview-${nextId()}`)
  const [email, setEmail] = useState('')
  const [expiresIn, setExpiresIn] = useState<ExpiresIn>('1h')
  const [sensitiveAttrs, setSensitiveAttrs] = useState<AttrEntry[]>([])
  const [nonSensitiveAttrs, setNonSensitiveAttrs] = useState<AttrEntry[]>([])
  const [activeJwt, setActiveJwt] = useState<string | null>(null)
  const [activeAttrs, setActiveAttrs] = useState<Record<string, unknown> | null>(null)

  type PassportSnapshot = {
    identityVerified: boolean
    contactId?: string
    resolution?: 'matched_external_id' | 'matched_email' | 'created'
    error?: string
  }
  const [passportSnapshot, setPassportSnapshot] = useState<PassportSnapshot | null>(null)
  const [iframeKey, setIframeKey] = useState(0)
  const [resetting, setResetting] = useState(false)

  const { data: identityState } = api.channel.getChatIdentityState.useQuery(
    { channelId: integrationId ?? '' },
    { enabled: !!integrationId }
  )
  const signTestJwt = api.chat.signTestJwt.useMutation()

  const handleClearVisitor = useCallback(async () => {
    if (resetting) return
    setResetting(true)
    try {
      // Clear the `auxx_chat_session_id` cookie on the API origin.
      await fetch(`${apiUrl}/api/chat/passport/reset`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {})
      // srcdoc iframes inherit the parent's origin, so the widget's
      // `window.localStorage` IS this page's localStorage. Rekeying the
      // iframe doesn't drop it — wipe the widget's keys here so the next
      // mount mints a fresh passport / participant and forgets the thread.
      const prefixes = [
        'auxx_passport_chat_',
        'auxx-chat-route:',
        'auxx-chat-expanded:',
        'auxx-chat-read:',
        'auxx-chat-privacy-dismissed:',
      ]
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const key = window.localStorage.key(i)
        if (key && prefixes.some((p) => key.startsWith(p))) {
          window.localStorage.removeItem(key)
        }
      }
      for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
        const key = window.sessionStorage.key(i)
        if (key?.startsWith('auxx-chat-identify:')) {
          window.sessionStorage.removeItem(key)
        }
      }
      setActiveJwt(null)
      setActiveAttrs(null)
      setPassportSnapshot(null)
    } finally {
      setIframeKey((k) => k + 1)
      setResetting(false)
    }
  }, [apiUrl, resetting])

  const handleSignAndBoot = useCallback(async () => {
    if (!integrationId) return
    setPassportSnapshot(null)
    try {
      const sensitive = attrsToObject(sensitiveAttrs)
      const nonSensitive = attrsToObject(nonSensitiveAttrs)
      const payload = {
        user_id: userId,
        ...(email ? { email } : {}),
        ...sensitive,
      }
      const { token } = await signTestJwt.mutateAsync({
        channelId: integrationId,
        payload,
        expiresIn,
      })

      // Preflight-mint from the parent so we can populate the status panel
      // with what the server resolved (identityVerified, contactId,
      // resolution path). The iframe will mint again itself for the actual
      // widget session — same JWT, same channel, same Contact.
      const userData: Record<string, unknown> = { auxx_user_jwt: token }
      if (Object.keys(nonSensitive).length > 0) userData.attributes = nonSensitive
      try {
        const res = await fetch(`${apiUrl}/api/chat/passport`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelId: integrationId, user_data: userData }),
        })
        const json = (await res.json()) as
          | {
              success: true
              data: {
                identityVerified?: boolean
                contactId?: string
                resolution?: 'matched_external_id' | 'matched_email' | 'created'
              }
            }
          | { success: false; error: { code: string; message: string } }
        if (!res.ok || !json.success) {
          setPassportSnapshot({
            identityVerified: false,
            error: 'success' in json && !json.success ? json.error.message : `HTTP ${res.status}`,
          })
        } else {
          setPassportSnapshot({
            identityVerified: !!json.data.identityVerified,
            contactId: json.data.contactId,
            resolution: json.data.resolution,
          })
        }
      } catch (err) {
        setPassportSnapshot({
          identityVerified: false,
          error: (err as Error).message,
        })
      }

      setActiveJwt(token)
      setActiveAttrs(Object.keys(nonSensitive).length > 0 ? nonSensitive : null)
      // Force programmatic boot when signing — declarative mode can't ship
      // the JWT alongside the script tag.
      setBootMode('programmatic')
      setIframeKey((k) => k + 1)
    } catch {
      // tRPC surfaces the error via signTestJwt.error — render below.
    }
  }, [
    apiUrl,
    email,
    expiresIn,
    integrationId,
    nonSensitiveAttrs,
    sensitiveAttrs,
    signTestJwt,
    userId,
  ])

  const handleClearIdentity = useCallback(() => {
    setActiveJwt(null)
    setActiveAttrs(null)
    setPassportSnapshot(null)
    setIdentityMode('anonymous')
    setIframeKey((k) => k + 1)
  }, [])

  const srcDoc = useMemo(() => {
    if (!integrationId) return null
    const vAttr = v ? ` data-v="${encodeURIComponent(v)}"` : ''
    const bundleSrc = `${appUrl}/scripts/chat-widget.js${v ? `?v=${encodeURIComponent(v)}` : ''}`
    const isDark = previewTheme === 'dark'
    const bg = isDark ? '#0d1117' : previewTheme === 'system' ? 'canvas' : '#f7f9fc'
    const fg = isDark ? '#e2e8f0' : '#1a202c'
    const muted = isDark ? '#94a3b8' : '#64748b'
    const cardBg = isDark ? '#161b22' : '#ffffff'
    const cardBorder = isDark ? '#30363d' : '#e2e8f0'

    // The boot snippet differs between modes. Declarative is the existing
    // `<script data-channel-id>` form. Programmatic mirrors what the npm
    // bootstrap does internally — set `__AUXX_CONFIG__`, then inject the
    // script tag — so the same hosted bundle picks up the JWT + attributes.
    const declarativeScript = `<script src="${bundleSrc}" data-channel-id="${integrationId}" data-theme="${previewTheme}"${vAttr} async defer></script>`

    const programmaticConfig: Record<string, unknown> = { apiBase: apiUrl }
    if (activeJwt) programmaticConfig.userJwt = activeJwt
    if (activeAttrs) programmaticConfig.attributes = activeAttrs
    const programmaticScript = `<script>
      window.__AUXX_CONFIG__ = ${JSON.stringify(programmaticConfig)};
    </script>
    <script src="${bundleSrc}" data-channel-id="${integrationId}" data-theme="${previewTheme}"${vAttr} async defer></script>`

    const bootHtml = bootMode === 'declarative' ? declarativeScript : programmaticScript

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Auxx Chat Widget Preview</title>
    <style>
      html, body { margin: 0; padding: 0; min-height: 100%; background: ${bg}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: ${fg}; }
      .stage { position: relative; min-height: 100vh; padding: 48px 64px 120px; overflow: hidden; }
      .blob { position: absolute; border-radius: 50%; filter: blur(40px); opacity: ${isDark ? 0.4 : 0.55}; pointer-events: none; }
      .blob-1 { width: 380px; height: 380px; top: -80px; left: -60px; background: #f472b6; }
      .blob-2 { width: 420px; height: 420px; top: 120px; right: 80px; background: #60a5fa; }
      .blob-3 { width: 320px; height: 320px; bottom: 60px; left: 30%; background: #34d399; }
      .blob-4 { width: 260px; height: 260px; bottom: -40px; right: 10%; background: #fbbf24; }
      .grid { position: relative; max-width: 960px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
      h1 { font-size: 32px; font-weight: 700; margin: 0 0 12px; letter-spacing: -0.02em; }
      h2 { font-size: 18px; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.01em; }
      p { font-size: 14px; line-height: 1.6; color: ${muted}; margin: 0 0 12px; }
      .card { background: ${cardBg}; border: 1px solid ${cardBorder}; border-radius: 12px; padding: 20px; }
      .center-card { position: relative; max-width: 380px; margin: 64px auto 0; padding: 32px; background: ${cardBg}; border: 1px solid ${cardBorder}; border-radius: 16px; box-shadow: 0 10px 30px -10px rgba(0,0,0,${isDark ? 0.6 : 0.15}); text-align: center; }
      .center-card .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: ${muted}; margin-bottom: 8px; }
      .center-card .title { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
      .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; background: ${isDark ? '#1e293b' : '#eef2ff'}; color: ${isDark ? '#a5b4fc' : '#4f46e5'}; font-size: 12px; font-weight: 500; margin-right: 6px; }
    </style>
  </head>
  <body>
    <div class="stage">
      <div class="blob blob-1"></div>
      <div class="blob blob-2"></div>
      <div class="blob blob-3"></div>
      <div class="blob blob-4"></div>

      <div class="center-card">
        <div class="label">Preview</div>
        <div class="title">Customer page mock</div>
      </div>

      <div class="grid" style="margin-top: 48px">
        <div>
          <h1>Welcome back</h1>
          <p>This is a sample marketing page sitting behind your chat widget. Drag the widget around, scroll, switch themes — the glass surface should always pick up whatever is behind it.</p>
          <p><span class="pill">Live</span><span class="pill">Beta</span><span class="pill">v2.4</span></p>
        </div>
        <div class="card">
          <h2>Recent activity</h2>
          <p>An order was placed for €128.00 about 4 minutes ago. Inventory levels updated automatically.</p>
          <p>Three new sign-ups overnight. Conversion is trending +12% week over week.</p>
        </div>
        <div class="card">
          <h2>Tasks</h2>
          <p>• Reply to support thread #4821<br/>• Review the new pricing draft<br/>• Approve the November invoice batch</p>
        </div>
        <div>
          <h2>What customers are saying</h2>
          <p>"Faster than every other helpdesk we tried." — Pia, Operations Lead</p>
          <p>"Setup took 10 minutes. The AI replies feel native, not templated." — Marc, Founder</p>
        </div>
      </div>
    </div>
    ${bootHtml}
  </body>
</html>`
  }, [activeAttrs, activeJwt, appUrl, apiUrl, bootMode, integrationId, previewTheme, v])

  if (!integrationId || !srcDoc) {
    return <div style={{ padding: 16 }}>Loading…</div>
  }

  const enforcementLabel = identityState
    ? ENFORCEMENT_LABELS[identityState.state]
    : ENFORCEMENT_LABELS.off
  const enforcementColor =
    identityState?.state === 'enforced'
      ? '#34d399'
      : identityState?.state === 'in_progress'
        ? '#fbbf24'
        : '#a0aec0'

  const noSigningKey = signTestJwt.error?.message === 'NO_SIGNING_KEY'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
      <div
        style={{
          padding: '8px 16px',
          background: '#2d3748',
          color: '#a0aec0',
          fontSize: 12,
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
        <span>
          Widget Preview &nbsp;|&nbsp; Channel:{' '}
          <code style={{ color: '#e2e8f0' }}>{integrationId}</code>
          <span
            style={{
              marginLeft: 10,
              padding: '2px 8px',
              borderRadius: 999,
              background: '#1a202c',
              color: enforcementColor,
              fontSize: 10,
              fontWeight: 600,
              border: `1px solid ${enforcementColor}`,
            }}>
            Enforcement: {enforcementLabel}
          </span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Segmented
            value={bootMode}
            onChange={setBootMode}
            options={[
              { value: 'declarative', label: 'Declarative' },
              { value: 'programmatic', label: 'Programmatic' },
            ]}
          />
          <Segmented
            value={identityMode}
            onChange={setIdentityMode}
            options={[
              { value: 'anonymous', label: 'Anonymous' },
              { value: 'identified', label: 'Identified' },
            ]}
          />
          <button
            type='button'
            onClick={handleClearVisitor}
            disabled={resetting}
            title='Clear the visitor session cookie + reload the widget. Fresh sessionId + Participant on next load.'
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              border: '1px solid #4a5568',
              cursor: resetting ? 'wait' : 'pointer',
              fontSize: 11,
              background: '#1a202c',
              color: '#e2e8f0',
              opacity: resetting ? 0.6 : 1,
            }}>
            {resetting ? 'Clearing…' : 'Clear visitor'}
          </button>
          <Segmented
            value={previewTheme}
            onChange={setPreviewTheme}
            options={(['light', 'dark', 'system'] as const).map((t) => ({
              value: t,
              label: THEME_LABELS[t],
            }))}
          />
        </div>
      </div>

      {identityMode === 'identified' && (
        <IdentityPanel
          userId={userId}
          email={email}
          expiresIn={expiresIn}
          sensitiveAttrs={sensitiveAttrs}
          nonSensitiveAttrs={nonSensitiveAttrs}
          activeJwt={activeJwt}
          passportSnapshot={passportSnapshot}
          signing={signTestJwt.isPending}
          signError={signTestJwt.error?.message ?? null}
          noSigningKey={noSigningKey}
          integrationId={integrationId}
          onUserIdChange={setUserId}
          onEmailChange={setEmail}
          onExpiresInChange={setExpiresIn}
          onSensitiveChange={setSensitiveAttrs}
          onNonSensitiveChange={setNonSensitiveAttrs}
          onSignAndBoot={handleSignAndBoot}
          onClearIdentity={handleClearIdentity}
        />
      )}

      <iframe
        key={`${previewTheme}-${bootMode}-${iframeKey}`}
        title='Chat Widget Preview'
        srcDoc={srcDoc}
        style={{ flex: '1 1 auto', border: 0, width: '100%' }}
      />
    </div>
  )
}

interface SegmentedProps<T extends string> {
  value: T
  onChange: (next: T) => void
  options: Array<{ value: T; label: string }>
}

function Segmented<T extends string>({ value, onChange, options }: SegmentedProps<T>) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        background: '#1a202c',
        borderRadius: 6,
        padding: 2,
      }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type='button'
          onClick={() => onChange(opt.value)}
          style={{
            padding: '3px 10px',
            borderRadius: 4,
            border: 'none',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: value === opt.value ? 600 : 400,
            background: value === opt.value ? '#4a5568' : 'transparent',
            color: value === opt.value ? '#f7fafc' : '#a0aec0',
            transition: 'background 0.15s',
          }}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}

interface IdentityPanelProps {
  userId: string
  email: string
  expiresIn: ExpiresIn
  sensitiveAttrs: AttrEntry[]
  nonSensitiveAttrs: AttrEntry[]
  activeJwt: string | null
  passportSnapshot: {
    identityVerified: boolean
    contactId?: string
    resolution?: 'matched_external_id' | 'matched_email' | 'created'
    error?: string
  } | null
  signing: boolean
  signError: string | null
  noSigningKey: boolean
  integrationId: string
  onUserIdChange: (v: string) => void
  onEmailChange: (v: string) => void
  onExpiresInChange: (v: ExpiresIn) => void
  onSensitiveChange: (v: AttrEntry[]) => void
  onNonSensitiveChange: (v: AttrEntry[]) => void
  onSignAndBoot: () => void
  onClearIdentity: () => void
}

function IdentityPanel(props: IdentityPanelProps) {
  return (
    <div
      style={{
        padding: '10px 16px',
        background: '#1a202c',
        color: '#cbd5e0',
        fontSize: 12,
        borderTop: '1px solid #2d3748',
        borderBottom: '1px solid #2d3748',
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 12,
      }}>
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <Field
            label='user_id'
            value={props.userId}
            onChange={props.onUserIdChange}
            placeholder='preview-…'
          />
          <Field
            label='email'
            value={props.email}
            onChange={props.onEmailChange}
            placeholder='optional'
          />
          <SelectField
            label='exp'
            value={props.expiresIn}
            onChange={(v) => props.onExpiresInChange(v as ExpiresIn)}
            options={[
              { value: '30s', label: '30s' },
              { value: '1m', label: '1m' },
              { value: '1h', label: '1h' },
              { value: '1d', label: '1d' },
            ]}
          />
        </div>
        <AttrsEditor
          label='Sensitive attributes (JWT claims)'
          entries={props.sensitiveAttrs}
          onChange={props.onSensitiveChange}
        />
        <AttrsEditor
          label='Non-sensitive attributes (Auxx.boot)'
          entries={props.nonSensitiveAttrs}
          onChange={props.onNonSensitiveChange}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button
            type='button'
            onClick={props.onSignAndBoot}
            disabled={props.signing || !props.userId}
            style={{
              padding: '4px 12px',
              borderRadius: 4,
              border: '1px solid #4a5568',
              cursor: props.signing ? 'wait' : 'pointer',
              fontSize: 11,
              background: '#3b4252',
              color: '#f7fafc',
              fontWeight: 600,
              opacity: props.signing || !props.userId ? 0.6 : 1,
            }}>
            {props.signing ? 'Signing…' : 'Sign & boot'}
          </button>
          {props.activeJwt && (
            <button
              type='button'
              onClick={props.onClearIdentity}
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                border: '1px solid #4a5568',
                cursor: 'pointer',
                fontSize: 11,
                background: '#1a202c',
                color: '#e2e8f0',
              }}>
              Clear identity
            </button>
          )}
        </div>
        {props.noSigningKey && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#fbbf24' }}>
            No active chat signing key for this channel. Create one in the channel settings →
            Identity tab, then retry.{' '}
            <a
              href={`/app/settings/channels/${props.integrationId}`}
              target='_blank'
              rel='noreferrer'
              style={{ color: '#60a5fa', textDecoration: 'underline' }}>
              Open settings
            </a>
          </div>
        )}
        {!props.noSigningKey && props.signError && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#f87171' }}>{props.signError}</div>
        )}
      </div>

      <div
        style={{
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: 6,
          padding: 10,
          fontSize: 11,
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        }}>
        <div style={{ fontWeight: 600, marginBottom: 6, fontFamily: 'inherit' }}>
          Server resolved
        </div>
        {props.passportSnapshot ? (
          props.passportSnapshot.error ? (
            <div style={{ color: '#f87171' }}>Error: {props.passportSnapshot.error}</div>
          ) : (
            <div style={{ display: 'grid', gap: 4 }}>
              <KV k='identityVerified' v={String(props.passportSnapshot.identityVerified)} />
              {props.passportSnapshot.contactId && (
                <KV k='contactId' v={props.passportSnapshot.contactId} />
              )}
              {props.passportSnapshot.resolution && (
                <KV k='resolution' v={props.passportSnapshot.resolution} />
              )}
            </div>
          )
        ) : (
          <div style={{ color: '#6b7280' }}>Sign & boot to populate.</div>
        )}
      </div>
    </div>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span style={{ color: '#9ca3af' }}>{k}:</span> <span style={{ color: '#e5e7eb' }}>{v}</span>
    </div>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

function Field({ label, value, onChange, placeholder }: FieldProps) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 auto' }}>
      <span style={{ fontSize: 10, color: '#9ca3af' }}>{label}</span>
      <input
        type='text'
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '3px 8px',
          background: '#0d1117',
          color: '#e5e7eb',
          border: '1px solid #30363d',
          borderRadius: 4,
          fontSize: 11,
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        }}
      />
    </label>
  )
}

interface SelectFieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}

function SelectField({ label, value, onChange, options }: SelectFieldProps) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: '#9ca3af' }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '3px 8px',
          background: '#0d1117',
          color: '#e5e7eb',
          border: '1px solid #30363d',
          borderRadius: 4,
          fontSize: 11,
        }}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

interface AttrsEditorProps {
  label: string
  entries: AttrEntry[]
  onChange: (next: AttrEntry[]) => void
}

function AttrsEditor({ label, entries, onChange }: AttrsEditorProps) {
  const handleAdd = () => onChange([...entries, { id: nextId(), key: '', value: '' }])
  const handleRemove = (id: string) => onChange(entries.filter((e) => e.id !== id))
  const handlePatch = (id: string, patch: Partial<AttrEntry>) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}>
        <span style={{ fontSize: 10, color: '#9ca3af' }}>{label}</span>
        <button
          type='button'
          onClick={handleAdd}
          style={{
            padding: '1px 8px',
            borderRadius: 4,
            border: '1px solid #30363d',
            background: 'transparent',
            color: '#9ca3af',
            fontSize: 10,
            cursor: 'pointer',
          }}>
          + Add
        </button>
      </div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 10, color: '#6b7280', fontStyle: 'italic' }}>none</div>
      ) : (
        <div style={{ display: 'grid', gap: 4 }}>
          {entries.map((entry) => (
            <div key={entry.id} style={{ display: 'flex', gap: 4 }}>
              <input
                type='text'
                value={entry.key}
                placeholder='key'
                onChange={(e) => handlePatch(entry.id, { key: e.target.value })}
                style={{
                  flex: '0 0 38%',
                  padding: '2px 6px',
                  background: '#0d1117',
                  color: '#e5e7eb',
                  border: '1px solid #30363d',
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                }}
              />
              <input
                type='text'
                value={entry.value}
                placeholder='value'
                onChange={(e) => handlePatch(entry.id, { value: e.target.value })}
                style={{
                  flex: '1 1 auto',
                  padding: '2px 6px',
                  background: '#0d1117',
                  color: '#e5e7eb',
                  border: '1px solid #30363d',
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                }}
              />
              <button
                type='button'
                onClick={() => handleRemove(entry.id)}
                style={{
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid #30363d',
                  background: 'transparent',
                  color: '#9ca3af',
                  fontSize: 10,
                  cursor: 'pointer',
                }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
