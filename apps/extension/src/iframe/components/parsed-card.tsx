// apps/extension/src/iframe/components/parsed-card.tsx

import type { ParsedCompany, ParsedPerson } from '../../lib/parsers/types'

type PersonProps = { person: ParsedPerson; company?: never }
type CompanyProps = { person?: never; company: ParsedCompany }
type Props = PersonProps | CompanyProps

type Normalized = {
  title: string
  avatarUrl?: string
  stat: { label: string; value: string }
}

function initials(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

/**
 * externalIds look like `linkedin:markus-klooth` or
 * `linkedin-company:auxx-ai`. Strip the prefix so we can show just the
 * readable slug in the card fallback.
 */
function externalIdSlug(externalId: string): string {
  const idx = externalId.indexOf(':')
  return idx >= 0 ? externalId.slice(idx + 1) : externalId
}

function normalize(props: Props): Normalized {
  if (props.person) {
    const p = props.person
    const title = p.fullName ?? (`${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || 'Unknown')
    const stat = p.primaryEmail
      ? { label: 'Email', value: p.primaryEmail }
      : p.phone
        ? { label: 'Phone', value: p.phone }
        : { label: 'Profile', value: externalIdSlug(p.externalId) }
    return { title, avatarUrl: p.avatarPreviewUrl ?? p.avatarUrl, stat }
  }
  const c = props.company!
  const title = c.name ?? 'Unknown'
  const stat = c.domain
    ? { label: 'Domain', value: c.domain }
    : { label: 'Profile', value: externalIdSlug(c.externalId) }
  return { title, avatarUrl: c.avatarPreviewUrl ?? c.avatarUrl, stat }
}

/**
 * Preview card for a parsed contact or company. Styled after the shadcn
 * illustration card — layered background plate, avatar tile, name + one
 * stat (email / phone / domain). Replaces the raw dl/dt/dd for the
 * capture flow.
 */
export function ParsedCard(props: Props) {
  const { title, avatarUrl, stat } = normalize(props)
  return (
    <div className='before:bg-card before:ring-border-illustration relative mx-auto  before:absolute before:inset-x-2 before:-bottom-2 before:top-2 before:rounded-2xl before:opacity-75 before:shadow before:ring-1'>
      <div className='bg-illustration ring-border-illustration shadow-black/[0.065] relative flex items-center gap-2 rounded-2xl p-1 shadow-md ring-1 backdrop-blur'>
        <div className='before:border-foreground/20 size-18 relative overflow-hidden rounded-xl shadow-md before:absolute before:inset-0 before:rounded-xl before:border'>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={title}
              width={72}
              height={72}
              className='h-full w-full object-cover'
            />
          ) : (
            <div className='flex h-full w-full items-center justify-center bg-muted text-sm font-medium text-muted-foreground'>
              {initials(title)}
            </div>
          )}
        </div>
        <div className='py-1 pr-4'>
          <div className='text-sm font-medium'>{title}</div>
          <div className='mt-1.5'>
            <div className='text-foreground/50 text-xs'>{stat.label}</div>
            <div className='mt-0.5 text-sm font-semibold break-all'>{stat.value}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
