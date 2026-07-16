// packages/email/src/templates/general/payment-receipt-email.tsx

import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailButton } from '../../components/email-button'
import { EmailHeading } from '../../components/email-text'
import { EmailTemplate } from '../../components/email-template'

void React

export interface PaymentReceiptEmailProps {
  name: string
  context: 'deposit' | 'invoice'
  documentNumber: string
  /** Integer cents. */
  amountPaid: number
  currency: string
  /** Integer cents. */
  remainingBalance: number
  /** ISO timestamp or `yyyy-mm-dd`. */
  paymentDate: string
  method?: string
  viewUrl: string
  businessName: string
  businessAddressLines: string[]
  businessPhone?: string
  businessWebsite?: string
  logoUrl?: string
  accentColor?: string
}

/** Integer cents → localized currency string (e.g. 12500 USD → "$125.00"). */
function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`
  }
}

function formatDate(value: string): string {
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { dateStyle: 'medium' })
}

const METHOD_LABELS: Record<string, string> = {
  card: 'Card',
  cash: 'Cash',
  check: 'Check',
  bank_transfer: 'Bank transfer',
  other: 'Other',
}

export async function PaymentReceiptEmail(
  props: PaymentReceiptEmailProps
): Promise<React.JSX.Element> {
  const {
    name,
    context,
    documentNumber,
    amountPaid,
    currency,
    remainingBalance,
    paymentDate,
    method,
    viewUrl,
    businessName,
    businessAddressLines,
    businessPhone,
    businessWebsite,
    logoUrl,
    accentColor,
  } = props

  const isDeposit = context === 'deposit'
  const heading = isDeposit ? 'Deposit received' : 'Payment received'
  const contextLine = isDeposit
    ? `held toward Quote ${documentNumber}`
    : `for Invoice ${documentNumber}`
  const ctaLabel = isDeposit ? 'View quote' : 'View invoice'
  const methodLabel = method ? (METHOD_LABELS[method] ?? method) : undefined

  return (
    <EmailTemplate
      logoUrl={logoUrl}
      business={{
        name: businessName,
        addressLines: businessAddressLines,
        phone: businessPhone,
        website: businessWebsite,
      }}>
      <Container>
        <EmailHeading>{heading}</EmailHeading>
        <Text>Hi {name},</Text>
        <Text>
          Thank you — we've received your {isDeposit ? 'deposit' : 'payment'} of{' '}
          <strong>{formatMoney(amountPaid, currency)}</strong> {contextLine}.
        </Text>

        <div
          style={{
            backgroundColor: '#f7fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '20px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: '8px 0' }}>
            {isDeposit ? 'Deposit' : 'Amount'} paid:{' '}
            <strong>{formatMoney(amountPaid, currency)}</strong>
          </Text>
          <Text style={{ margin: '8px 0' }}>Date: {formatDate(paymentDate)}</Text>
          {methodLabel && <Text style={{ margin: '8px 0' }}>Method: {methodLabel}</Text>}
          <Text style={{ margin: '8px 0' }}>
            {isDeposit ? 'Quote' : 'Invoice'}: {documentNumber}
          </Text>
          {remainingBalance > 0 && (
            <Text style={{ margin: '8px 0' }}>
              {isDeposit ? 'Remaining on quote' : 'Remaining balance'}:{' '}
              <strong>{formatMoney(remainingBalance, currency)}</strong>
            </Text>
          )}
        </div>

        <EmailButton
          href={viewUrl}
          label={ctaLabel}
          style={accentColor ? { backgroundColor: accentColor } : undefined}
        />

        <Text className='mb-0'>
          {isDeposit ? "We'll be in touch to schedule your job." : 'Thank you for your business.'}
        </Text>
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function PaymentReceiptText(props: PaymentReceiptEmailProps): string {
  const {
    name,
    context,
    documentNumber,
    amountPaid,
    currency,
    remainingBalance,
    paymentDate,
    method,
    viewUrl,
    businessName,
  } = props
  const isDeposit = context === 'deposit'
  const methodLabel = method ? (METHOD_LABELS[method] ?? method) : undefined
  const remainingLine =
    remainingBalance > 0
      ? `${isDeposit ? 'Remaining on quote' : 'Remaining balance'}: ${formatMoney(remainingBalance, currency)}\n`
      : ''

  return `
${isDeposit ? 'Deposit received' : 'Payment received'}

Hi ${name},

Thank you — we've received your ${isDeposit ? 'deposit' : 'payment'} of ${formatMoney(amountPaid, currency)} ${
    isDeposit ? `held toward Quote ${documentNumber}` : `for Invoice ${documentNumber}`
  }.

${isDeposit ? 'Deposit' : 'Amount'} paid: ${formatMoney(amountPaid, currency)}
Date: ${formatDate(paymentDate)}
${methodLabel ? `Method: ${methodLabel}\n` : ''}${isDeposit ? 'Quote' : 'Invoice'}: ${documentNumber}
${remainingLine}
${isDeposit ? 'View quote' : 'View invoice'}: ${viewUrl}

${isDeposit ? "We'll be in touch to schedule your job." : 'Thank you for your business.'}

--
${businessName}
  `.trim()
}

export default PaymentReceiptEmail

// Preview props for React Email dev server
PaymentReceiptEmail.PreviewProps = {
  name: 'Alex Rivera',
  context: 'deposit',
  documentNumber: 'Q-1042',
  amountPaid: 25000,
  currency: 'USD',
  remainingBalance: 75000,
  paymentDate: '2026-07-16',
  method: 'card',
  viewUrl: 'https://app.auxx.ai/quote/kRGnq-cj9V9zwPdIav0a2',
  businessName: 'Acme Plumbing',
  businessAddressLines: ['123 Main St', 'Springfield, IL 62701'],
  businessPhone: '(555) 123-4567',
  businessWebsite: 'https://acmeplumbing.example',
  accentColor: '#2563eb',
} satisfies PaymentReceiptEmailProps
