// apps/build/src/app/(portal)/[slug]/settings/members/_components/access-level-select.tsx

'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'

type AccessLevel = 'admin' | 'member'

interface AccessLevelSelectProps {
  value: AccessLevel
  onValueChange: (value: AccessLevel) => void
  disabled?: boolean
}

/** Reusable select for picking admin | member access level */
export function AccessLevelSelect({ value, onValueChange, disabled }: AccessLevelSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder='Select access level' />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='member'>Member</SelectItem>
        <SelectItem value='admin'>Admin</SelectItem>
      </SelectContent>
    </Select>
  )
}
