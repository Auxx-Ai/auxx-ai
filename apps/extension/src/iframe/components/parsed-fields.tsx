// apps/extension/src/iframe/components/parsed-fields.tsx

import { useMemo } from 'react'
import type { ParsedCompany, ParsedPerson } from '../../lib/parsers/types'

type PersonProps = { person: ParsedPerson; company?: never }
type CompanyProps = { person?: never; company: ParsedCompany }
type Props = PersonProps | CompanyProps

/**
 * Minimal read-only dl/dt/dd rendering of parser output. Used by the root
 * capture view and the contact/company detail stubs. Editing is deferred to
 * plan 18 (needs typed record.get/update + a field renderer).
 */
export function ParsedFields(props: Props) {
  const rows = useMemo<Array<[string, string]>>(() => {
    if (props.person) {
      const p = props.person
      return [
        ['Name', p.fullName ?? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()],
        ['Email', p.primaryEmail ?? ''],
        ['Phone', p.phone ?? ''],
        ['Notes', p.notes ?? ''],
        ['External ID', p.externalId],
      ].filter((r): r is [string, string] => Boolean(r[1]))
    }
    const c = props.company!
    return [
      ['Name', c.name ?? ''],
      ['Domain', c.domain ?? ''],
      ['Notes', c.notes ?? ''],
      ['External ID', c.externalId],
    ].filter((r): r is [string, string] => Boolean(r[1]))
  }, [props])

  return (
    <dl className='grid grid-cols-[90px_1fr] gap-x-3 gap-y-1.5 text-sm'>
      {rows.map(([label, value]) => (
        <div key={label} className='contents'>
          <dt className='text-xs text-muted-foreground'>{label}</dt>
          <dd className='m-0 break-words'>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
