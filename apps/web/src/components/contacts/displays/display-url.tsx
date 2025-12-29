'use client'
// apps/web/src/components/contacts/displays/display-url.tsx

import { ExternalLink } from 'lucide-react'
import { useMemo } from 'react'
import DisplayWrapper from './display-wrapper'
import { usePropertyContext } from '../drawer/property-provider'
import { FieldOptionButton } from './field-option-button'
import { Badge } from '@auxx/ui/components/badge'

/**
 * normalizeUrl function
 * Ensures that the provided URL includes a protocol and is syntactically valid
 */
function normalizeUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
  const candidate = hasProtocol ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(candidate)
    return parsed.toString()
  } catch {
    return null
  }
}

/**
 * formatUrlForDisplay function
 * Produces a human-friendly URL label without protocol noise
 */
function formatUrlForDisplay(url: string): string {
  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname
    const search = parsed.search
    const hash = parsed.hash
    const host = parsed.hostname.replace(/^www\./, '')
    return `${host}${pathname}${search}${hash}` || host
  } catch {
    return url
  }
}

/**
 * DisplayUrl component
 * Renders a URL value with action buttons to open and copy the link
 */
export function DisplayUrl() {
  const { value } = usePropertyContext()

  const normalizedValue = useMemo(() => {
    if (typeof value !== 'string') return null
    return normalizeUrl(value)
  }, [value])

  const displayValue = useMemo(() => {
    if (!normalizedValue) return null
    return formatUrlForDisplay(normalizedValue)
  }, [normalizedValue])

  if (!normalizedValue || !displayValue) {
    return (
      <DisplayWrapper copyValue={null}>
        <Badge variant="pill">-</Badge>
      </DisplayWrapper>
    )
  }

  const buttons = [
    <FieldOptionButton key="open" label="Open website" href={normalizedValue}>
      <ExternalLink />
    </FieldOptionButton>,
  ]

  return (
    <DisplayWrapper copyValue={normalizedValue} buttons={buttons}>
      <Badge variant="pill">{displayValue}</Badge>
    </DisplayWrapper>
  )
}
