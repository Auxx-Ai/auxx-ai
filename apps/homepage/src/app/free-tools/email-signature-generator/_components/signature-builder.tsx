// apps/homepage/src/app/free-tools/email-signature-generator/_components/signature-builder.tsx
'use client'

import { Check, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

type SignatureData = {
  fullName: string
  jobTitle: string
  companyName: string
  pronouns: string
  email: string
  phone: string
  website: string
  address: string
  linkedin: string
  twitter: string
  github: string
  instagram: string
  avatarUrl: string
  logoUrl: string
  primaryColor: string
  fontFamily: string
}

type TemplateId = 'minimal' | 'two-column' | 'stacked' | 'compact'

const DEFAULT_DATA: SignatureData = {
  fullName: 'Alex Morgan',
  jobTitle: 'Customer Success Lead',
  companyName: 'Acme Co.',
  pronouns: '',
  email: 'alex@acme.co',
  phone: '+1 (415) 555-0134',
  website: 'acme.co',
  address: '',
  linkedin: 'linkedin.com/in/alexmorgan',
  twitter: '',
  github: '',
  instagram: '',
  avatarUrl: '',
  logoUrl: '',
  primaryColor: '#18181b',
  fontFamily: 'Arial, Helvetica, sans-serif',
}

const FONT_OPTIONS = [
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
]

function esc(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function url(raw: string): string {
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.includes('@')) return `mailto:${raw}`
  return `https://${raw}`
}

function renderMinimal(d: SignatureData): string {
  const name = esc(d.fullName) || ''
  const title = [d.jobTitle, d.companyName].filter(Boolean).map(esc).join(' · ')
  const pronouns = d.pronouns
    ? `<span style="color:#71717a;font-weight:normal;"> (${esc(d.pronouns)})</span>`
    : ''
  const rows: string[] = []
  if (d.email)
    rows.push(
      `<a href="mailto:${esc(d.email)}" style="color:${esc(d.primaryColor)};text-decoration:none;">${esc(d.email)}</a>`
    )
  if (d.phone) rows.push(esc(d.phone))
  if (d.website)
    rows.push(
      `<a href="${esc(url(d.website))}" style="color:${esc(d.primaryColor)};text-decoration:none;">${esc(d.website)}</a>`
    )
  const social: string[] = []
  if (d.linkedin)
    social.push(
      `<a href="${esc(url(d.linkedin))}" style="color:${esc(d.primaryColor)};text-decoration:none;">LinkedIn</a>`
    )
  if (d.twitter)
    social.push(
      `<a href="${esc(url(d.twitter.startsWith('http') ? d.twitter : `https://x.com/${d.twitter.replace(/^@/, '')}`))}" style="color:${esc(d.primaryColor)};text-decoration:none;">X</a>`
    )
  if (d.github)
    social.push(
      `<a href="${esc(url(d.github.startsWith('http') ? d.github : `https://github.com/${d.github.replace(/^@/, '')}`))}" style="color:${esc(d.primaryColor)};text-decoration:none;">GitHub</a>`
    )
  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:${esc(d.fontFamily)};font-size:13px;line-height:1.5;color:#27272a;">
  <tr><td>
    <div style="font-weight:600;color:${esc(d.primaryColor)};font-size:14px;">${name}${pronouns}</div>
    ${title ? `<div style="color:#52525b;">${title}</div>` : ''}
    ${rows.length ? `<div style="margin-top:6px;color:#52525b;">${rows.join(' &nbsp;·&nbsp; ')}</div>` : ''}
    ${social.length ? `<div style="margin-top:4px;">${social.join(' &nbsp;·&nbsp; ')}</div>` : ''}
  </td></tr>
</table>`
}

function renderTwoColumn(d: SignatureData): string {
  const avatar = d.avatarUrl
    ? `<img src="${esc(d.avatarUrl)}" width="64" height="64" alt="${esc(d.fullName)}" style="border-radius:50%;display:block;" />`
    : `<div style="width:64px;height:64px;border-radius:50%;background:${esc(d.primaryColor)};color:#fff;font-size:22px;font-weight:600;text-align:center;line-height:64px;font-family:${esc(d.fontFamily)};">${esc((d.fullName.match(/\b\w/g) ?? []).slice(0, 2).join('').toUpperCase()) || '·'}</div>`

  const contact: string[] = []
  if (d.email)
    contact.push(
      `<a href="mailto:${esc(d.email)}" style="color:${esc(d.primaryColor)};text-decoration:none;">${esc(d.email)}</a>`
    )
  if (d.phone) contact.push(esc(d.phone))
  if (d.website)
    contact.push(
      `<a href="${esc(url(d.website))}" style="color:${esc(d.primaryColor)};text-decoration:none;">${esc(d.website)}</a>`
    )

  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:${esc(d.fontFamily)};font-size:13px;line-height:1.5;color:#27272a;">
  <tr>
    <td valign="top" style="padding-right:16px;">${avatar}</td>
    <td valign="top" style="border-left:2px solid ${esc(d.primaryColor)};padding-left:16px;">
      <div style="font-weight:600;color:${esc(d.primaryColor)};font-size:15px;">${esc(d.fullName)}${d.pronouns ? ` <span style="color:#71717a;font-weight:normal;font-size:12px;">(${esc(d.pronouns)})</span>` : ''}</div>
      ${d.jobTitle ? `<div style="color:#52525b;">${esc(d.jobTitle)}${d.companyName ? ` at ${esc(d.companyName)}` : ''}</div>` : d.companyName ? `<div style="color:#52525b;">${esc(d.companyName)}</div>` : ''}
      ${contact.length ? `<div style="margin-top:8px;color:#52525b;">${contact.map((c) => `<div>${c}</div>`).join('')}</div>` : ''}
    </td>
  </tr>
</table>`
}

function renderStacked(d: SignatureData): string {
  const logo = d.logoUrl
    ? `<img src="${esc(d.logoUrl)}" alt="${esc(d.companyName)}" style="max-height:32px;display:block;margin-bottom:8px;" />`
    : ''

  const contact: string[] = []
  if (d.email)
    contact.push(
      `<a href="mailto:${esc(d.email)}" style="color:${esc(d.primaryColor)};text-decoration:none;">${esc(d.email)}</a>`
    )
  if (d.phone) contact.push(esc(d.phone))
  if (d.website)
    contact.push(
      `<a href="${esc(url(d.website))}" style="color:${esc(d.primaryColor)};text-decoration:none;">${esc(d.website)}</a>`
    )
  if (d.address) contact.push(esc(d.address).replace(/\n/g, '<br />'))

  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:${esc(d.fontFamily)};font-size:13px;line-height:1.5;color:#27272a;">
  <tr><td style="border-left:3px solid ${esc(d.primaryColor)};padding-left:12px;">
    ${logo}
    <div style="font-weight:600;color:${esc(d.primaryColor)};font-size:15px;">${esc(d.fullName)}${d.pronouns ? ` <span style="color:#71717a;font-weight:normal;font-size:12px;">(${esc(d.pronouns)})</span>` : ''}</div>
    ${d.jobTitle ? `<div style="color:#52525b;">${esc(d.jobTitle)}</div>` : ''}
    ${d.companyName ? `<div style="color:#52525b;">${esc(d.companyName)}</div>` : ''}
    ${contact.length ? `<div style="margin-top:8px;color:#52525b;">${contact.map((c) => `<div>${c}</div>`).join('')}</div>` : ''}
  </td></tr>
</table>`
}

function renderCompact(d: SignatureData): string {
  const line1 = [d.fullName, d.jobTitle].filter(Boolean).map(esc).join(' · ')
  const line2: string[] = []
  if (d.email)
    line2.push(
      `<a href="mailto:${esc(d.email)}" style="color:${esc(d.primaryColor)};text-decoration:none;">${esc(d.email)}</a>`
    )
  if (d.phone) line2.push(esc(d.phone))
  if (d.website)
    line2.push(
      `<a href="${esc(url(d.website))}" style="color:${esc(d.primaryColor)};text-decoration:none;">${esc(d.website)}</a>`
    )
  if (d.companyName) line2.push(esc(d.companyName))

  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:${esc(d.fontFamily)};font-size:13px;line-height:1.5;color:#27272a;">
  <tr><td>
    <div style="font-weight:600;color:${esc(d.primaryColor)};">${line1}</div>
    ${line2.length ? `<div style="color:#52525b;">${line2.join(' | ')}</div>` : ''}
  </td></tr>
</table>`
}

const RENDERERS: Record<TemplateId, (d: SignatureData) => string> = {
  minimal: renderMinimal,
  'two-column': renderTwoColumn,
  stacked: renderStacked,
  compact: renderCompact,
}

const TEMPLATE_META: { id: TemplateId; label: string; description: string }[] = [
  { id: 'minimal', label: 'Minimal', description: 'Clean single block, contact inline.' },
  { id: 'two-column', label: 'Two column', description: 'Avatar left, details right.' },
  { id: 'stacked', label: 'Stacked with accent', description: 'Logo on top, colored left border.' },
  { id: 'compact', label: 'Compact', description: 'Two lines, pipe-separated.' },
]

type TextFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}

function TextField({ label, value, onChange, placeholder, type = 'text' }: TextFieldProps) {
  return (
    <div className='space-y-1'>
      <label className='text-xs font-medium'>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className='h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
      />
    </div>
  )
}

export function SignatureBuilder() {
  const [data, setData] = useState<SignatureData>(DEFAULT_DATA)
  const [template, setTemplate] = useState<TemplateId>('minimal')
  const [copied, setCopied] = useState<'html' | 'source' | null>(null)

  const update = <K extends keyof SignatureData>(key: K, value: SignatureData[K]) =>
    setData((prev) => ({ ...prev, [key]: value }))

  const html = useMemo(() => RENDERERS[template](data), [template, data])

  async function copyRich() {
    try {
      const blob = new Blob([html], { type: 'text/html' })
      const textBlob = new Blob([html], { type: 'text/plain' })
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob }),
        ])
      } else {
        await navigator.clipboard.writeText(html)
      }
      setCopied('html')
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setCopied(null)
    }
  }

  async function copySource() {
    try {
      await navigator.clipboard.writeText(html)
      setCopied('source')
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setCopied(null)
    }
  }

  return (
    <div className='not-prose space-y-6'>
      <div className='grid gap-6 rounded-xl border border-border bg-card p-6 shadow-sm lg:grid-cols-[300px_1fr] lg:p-8'>
        <div className='space-y-5'>
          <div>
            <h2 className='text-base font-semibold'>Your details</h2>
            <p className='text-xs text-muted-foreground'>Leave anything blank you do not want.</p>
          </div>

          <div className='space-y-3'>
            <p className='text-xs font-medium uppercase tracking-wider text-muted-foreground'>
              Identity
            </p>
            <TextField
              label='Full name'
              value={data.fullName}
              onChange={(v) => update('fullName', v)}
            />
            <TextField
              label='Job title'
              value={data.jobTitle}
              onChange={(v) => update('jobTitle', v)}
            />
            <TextField
              label='Company'
              value={data.companyName}
              onChange={(v) => update('companyName', v)}
            />
            <TextField
              label='Pronouns (optional)'
              value={data.pronouns}
              onChange={(v) => update('pronouns', v)}
              placeholder='she/her'
            />
          </div>

          <div className='space-y-3'>
            <p className='text-xs font-medium uppercase tracking-wider text-muted-foreground'>
              Contact
            </p>
            <TextField
              label='Email'
              value={data.email}
              onChange={(v) => update('email', v)}
              type='email'
            />
            <TextField label='Phone' value={data.phone} onChange={(v) => update('phone', v)} />
            <TextField
              label='Website'
              value={data.website}
              onChange={(v) => update('website', v)}
              placeholder='acme.co'
            />
          </div>

          <div className='space-y-3'>
            <p className='text-xs font-medium uppercase tracking-wider text-muted-foreground'>
              Social (optional)
            </p>
            <TextField
              label='LinkedIn'
              value={data.linkedin}
              onChange={(v) => update('linkedin', v)}
              placeholder='linkedin.com/in/…'
            />
            <TextField
              label='X / Twitter'
              value={data.twitter}
              onChange={(v) => update('twitter', v)}
              placeholder='@handle'
            />
            <TextField
              label='GitHub'
              value={data.github}
              onChange={(v) => update('github', v)}
              placeholder='@handle'
            />
          </div>

          <div className='space-y-3'>
            <p className='text-xs font-medium uppercase tracking-wider text-muted-foreground'>
              Appearance
            </p>
            <div className='space-y-1'>
              <label className='text-xs font-medium'>Template</label>
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value as TemplateId)}
                className='h-8 w-full rounded-md border border-input bg-background px-2 text-xs'>
                {TEMPLATE_META.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} — {t.description}
                  </option>
                ))}
              </select>
            </div>
            <div className='space-y-1'>
              <label className='text-xs font-medium'>Primary color</label>
              <div className='flex items-center gap-2'>
                <input
                  type='color'
                  value={data.primaryColor}
                  onChange={(e) => update('primaryColor', e.target.value)}
                  className='h-8 w-10 cursor-pointer rounded-md border border-input bg-background'
                />
                <input
                  type='text'
                  value={data.primaryColor}
                  onChange={(e) => update('primaryColor', e.target.value)}
                  className='h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs'
                />
              </div>
            </div>
            <div className='space-y-1'>
              <label className='text-xs font-medium'>Font</label>
              <select
                value={data.fontFamily}
                onChange={(e) => update('fontFamily', e.target.value)}
                className='h-8 w-full rounded-md border border-input bg-background px-2 text-xs'>
                {FONT_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            {template === 'two-column' ? (
              <TextField
                label='Avatar URL (optional)'
                value={data.avatarUrl}
                onChange={(v) => update('avatarUrl', v)}
                placeholder='https://…/photo.jpg'
              />
            ) : null}
            {template === 'stacked' ? (
              <TextField
                label='Logo URL (optional)'
                value={data.logoUrl}
                onChange={(v) => update('logoUrl', v)}
                placeholder='https://…/logo.png'
              />
            ) : null}
          </div>
        </div>

        <div className='space-y-4'>
          <div>
            <h2 className='text-base font-semibold'>Live preview</h2>
            <p className='text-xs text-muted-foreground'>
              This is how the signature will paste into Gmail, Outlook, or Apple Mail.
            </p>
          </div>

          <div className='rounded-lg border border-border bg-background p-5'>
            <div className='mb-3 font-mono text-xs text-muted-foreground'>—</div>
            <div
              className='bg-white p-2 text-black'
              style={{ colorScheme: 'light' }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>

          <div className='flex flex-wrap gap-2'>
            <Button type='button' onClick={copyRich}>
              {copied === 'html' ? <Check className='size-3.5' /> : <Copy className='size-3.5' />}
              {copied === 'html' ? 'Copied' : 'Copy signature (for Gmail / Outlook)'}
            </Button>
            <Button type='button' variant='outline' onClick={copySource}>
              {copied === 'source' ? <Check className='size-3.5' /> : <Copy className='size-3.5' />}
              {copied === 'source' ? 'Copied' : 'Copy HTML source'}
            </Button>
          </div>
        </div>
      </div>

      <div className='grid gap-3 md:grid-cols-3'>
        <details className='group rounded-lg border border-border bg-card p-4 text-sm'>
          <summary className='cursor-pointer font-medium'>Install in Gmail</summary>
          <ol className='mt-3 list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground'>
            <li>Click "Copy signature" above</li>
            <li>In Gmail, open Settings (gear icon) → See all settings</li>
            <li>Scroll to "Signature" and click "Create new"</li>
            <li>Name it and paste the signature into the editor</li>
            <li>Under "Signature defaults", pick this one for new emails and replies</li>
            <li>Save at the bottom</li>
          </ol>
        </details>
        <details className='group rounded-lg border border-border bg-card p-4 text-sm'>
          <summary className='cursor-pointer font-medium'>Install in Outlook</summary>
          <ol className='mt-3 list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground'>
            <li>Click "Copy signature" above</li>
            <li>Outlook web: Settings → Mail → Compose and reply → Email signature</li>
            <li>Outlook desktop: File → Options → Mail → Signatures</li>
            <li>Paste the signature into the editor</li>
            <li>Set it as the default for new messages and replies</li>
            <li>Save</li>
          </ol>
        </details>
        <details className='group rounded-lg border border-border bg-card p-4 text-sm'>
          <summary className='cursor-pointer font-medium'>Install in Apple Mail</summary>
          <ol className='mt-3 list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground'>
            <li>Click "Copy signature" above</li>
            <li>In Apple Mail: Mail → Settings → Signatures</li>
            <li>Pick your account, click + to add a signature</li>
            <li>Uncheck "Always match my default message font"</li>
            <li>Paste the signature into the editor</li>
            <li>Drag the signature name onto your account to set as default</li>
          </ol>
        </details>
      </div>
    </div>
  )
}
