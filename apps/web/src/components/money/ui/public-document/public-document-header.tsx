// apps/web/src/components/money/ui/public-document/public-document-header.tsx

// Shared branded header + "billed to"/"prepared for" contact block for public documents
// (quote acceptance, invoice pay) — translucent dark styling to match the ColorfulBg shell.

import { formatDocumentDate } from './format'

interface PublicDocumentHeaderProps {
  logoUrl?: string | null
  companyName?: string | null
  email?: string | null
  phone?: string | null
  /** 'Invoice' | 'Quote' — also the fallback title when no company name is set. */
  documentLabel: string
  documentNumber: string
  issuedAt: string
  /** Second date row label — e.g. 'Due' for invoices, 'Valid until' for quotes. */
  secondaryDateLabel?: string
  secondaryDateValue?: string | null
}

/** Business branding + document number/dates header, shared across public documents. */
export function PublicDocumentHeader({
  logoUrl,
  companyName,
  email,
  phone,
  documentLabel,
  documentNumber,
  issuedAt,
  secondaryDateLabel,
  secondaryDateValue,
}: PublicDocumentHeaderProps) {
  return (
    <div className='flex flex-wrap items-start justify-between gap-4 border-white/10 border-b pb-6'>
      <div>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={companyName ?? 'Business logo'}
            className='mb-2 h-10 max-w-[180px] object-contain'
          />
        ) : null}
        <p className='font-semibold text-lg text-white/90'>{companyName || documentLabel}</p>
        {email ? <p className='text-sm text-white/50'>{email}</p> : null}
        {phone ? <p className='text-sm text-white/50'>{phone}</p> : null}
      </div>
      <div className='text-right'>
        <p className='font-semibold text-lg text-white/90'>
          {documentLabel} {documentNumber}
        </p>
        <p className='text-sm text-white/50'>Issued {formatDocumentDate(issuedAt)}</p>
        {secondaryDateLabel && secondaryDateValue ? (
          <p className='text-sm text-white/50'>
            {secondaryDateLabel} {formatDocumentDate(secondaryDateValue)}
          </p>
        ) : null}
      </div>
    </div>
  )
}

interface PublicDocumentContactProps {
  label: string
  name: string
  email?: string | null
}

/** The "Billed to" / "Prepared for" contact block, shared across public documents. */
export function PublicDocumentContact({ label, name, email }: PublicDocumentContactProps) {
  return (
    <div className='mt-6 flex flex-col gap-1'>
      <p className='text-white/50 text-xs uppercase tracking-wide'>{label}</p>
      <p className='font-medium text-white/90'>{name || '—'}</p>
      {email ? <p className='text-sm text-white/50'>{email}</p> : null}
    </div>
  )
}
