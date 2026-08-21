// apps/web/src/components/dispatch/ui/team-card.tsx
'use client'

import { getColorSwatch, getOptionColor } from '@auxx/lib/custom-fields/client'
import type { SelectOptionColor } from '@auxx/types/custom-field'
import { Badge } from '@auxx/ui/components/badge'
import {
  ListCard,
  type ListCardMenuItem,
  type ListCardStatus,
  renderBadgeChips,
} from '@auxx/ui/components/list-card'
import { cn } from '@auxx/ui/lib/utils'
import { Users } from 'lucide-react'
import type { DispatchWorkerRow } from './worker-card'

/** Corner status dot from the team's active flag. */
function teamStatus(team: DispatchWorkerRow): ListCardStatus {
  return team.isActive
    ? { tone: 'good', label: 'Active — shown on the board' }
    : { tone: 'muted', label: 'Inactive — hidden from the board' }
}

/** "Bob · Carla" — a quick member roster hint under the team name. */
function memberHint(team: DispatchWorkerRow): string {
  const names = (team.members ?? []).map((m) => m.name || 'Unnamed member')
  return names.length > 0 ? names.join(' · ') : 'No members yet'
}

interface TeamCardProps {
  team: DispatchWorkerRow
  /** Omit to render a read-only tile. */
  onClick?: (team: DispatchWorkerRow) => void
  /** Kebab-menu actions (settings grid) — omitted in read-only contexts. */
  menuItems?: ListCardMenuItem[]
}

/**
 * One dispatch team tile: color icon, name, member roster hint, active status
 * dot, board-color chip (45-teams.md §6). Click opens the team dialog.
 */
export function TeamCard({ team, onClick, menuItems }: TeamCardProps) {
  const name = team.name || 'Unnamed team'

  return (
    <ListCard
      icon={<Users className={cn('size-4', team.color ? 'text-white' : 'text-muted-foreground')} />}
      classNames={{ icon: team.color ? getColorSwatch(team.color) : undefined }}
      title={name}
      subtitle={memberHint(team)}
      status={teamStatus(team)}
      headerEnd={renderBadgeChips([
        team.isActive
          ? { label: 'Active', variant: 'green', description: 'Shown on the board' }
          : { label: 'Inactive', variant: 'gray', description: 'Hidden from the board' },
      ])}
      badges={
        team.color ? (
          <Badge variant='gray' size='sm' className='gap-1.5'>
            <span className={cn('size-2 rounded-full', getColorSwatch(team.color))} />
            {getOptionColor(team.color as SelectOptionColor).label}
          </Badge>
        ) : undefined
      }
      onClick={onClick ? () => onClick(team) : undefined}
      menuItems={menuItems}
    />
  )
}
