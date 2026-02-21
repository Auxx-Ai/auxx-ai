// apps/web/src/components/config/ui/source-badge.tsx
'use client'

import type { ConfigSource, ConfigVariableType } from '@auxx/types/config'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import {
  Braces,
  Circle,
  Database,
  Hash,
  List,
  type LucideIcon,
  Terminal,
  ToggleLeft,
  Type,
} from 'lucide-react'

/** Style map for source badges */
const SOURCE_STYLES: Record<ConfigSource, { variant: Variant; label: string; icon: LucideIcon }> = {
  DATABASE: { variant: 'green', label: 'Database', icon: Database },
  ENVIRONMENT: { variant: 'purple', label: 'Env', icon: Terminal },
  DEFAULT: { variant: 'gray', label: 'Default', icon: Circle },
}

interface SourceBadgeProps {
  source: ConfigSource
}

/**
 * Badge showing where a config value came from.
 */
export function SourceBadge({ source }: SourceBadgeProps) {
  const style = SOURCE_STYLES[source] ?? SOURCE_STYLES.DEFAULT
  const Icon = style.icon
  return (
    <Badge variant={style.variant} size='sm'>
      <Icon /> {style.label}
    </Badge>
  )
}

/** Style map for variable type badges */
const TYPE_STYLES: Record<ConfigVariableType, { label: string; icon: LucideIcon }> = {
  STRING: { label: 'String', icon: Type },
  NUMBER: { label: 'Number', icon: Hash },
  BOOLEAN: { label: 'Boolean', icon: ToggleLeft },
  ENUM: { label: 'Enum', icon: List },
  ARRAY: { label: 'Array', icon: Braces },
}

interface TypeBadgeProps {
  type: ConfigVariableType
}

/**
 * Badge showing the variable's data type.
 */
export function TypeBadge({ type }: TypeBadgeProps) {
  const style = TYPE_STYLES[type] ?? TYPE_STYLES.STRING
  const Icon = style.icon
  return (
    <Badge variant='amber' size='sm'>
      <Icon /> {style.label}
    </Badge>
  )
}
