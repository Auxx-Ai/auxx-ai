// apps/web/src/components/workflow/utils/icon-helper.tsx

import React from 'react'
import { Circle } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { BaseType } from '../types/unified-types'
import { getIcon as getIconData } from '~/components/pickers/icon-picker/icon-data'

/**
 * Get an icon component by name
 * Now uses the unified icon system
 */
export const getIcon = (
  iconName: string,
  className: string = 'size-4',
  style?: React.CSSProperties
): React.ReactElement => {
  const iconData = getIconData(iconName)

  if (!iconData) {
    console.warn(`Icon not found: ${iconName}, using fallback`)
    return <Circle className={className} style={style} />
  }

  const IconComponent = iconData.icon
  return <IconComponent className={className} style={style} />
}

/**
 * Variable type icon mapping to new icon system
 */
export const VAR_TYPE_ICON_MAP: Record<BaseType, string> = {
  [BaseType.STRING]: 'type',
  [BaseType.NUMBER]: 'hash',
  [BaseType.BOOLEAN]: 'toggle-left',
  [BaseType.OBJECT]: 'braces',
  [BaseType.ARRAY]: 'list',
  [BaseType.DATE]: 'calendar',
  [BaseType.DATETIME]: 'clock',
  [BaseType.TIME]: 'clock',
  [BaseType.FILE]: 'file',
  [BaseType.REFERENCE]: 'link',
  [BaseType.RELATION]: 'link',
  [BaseType.EMAIL]: 'mail',
  [BaseType.URL]: 'link',
  [BaseType.PHONE]: 'phone',
  [BaseType.ENUM]: 'list-filter',
  [BaseType.JSON]: 'file-text',
  [BaseType.SECRET]: 'lock',
  [BaseType.ANY]: 'box',
  [BaseType.NULL]: 'minus',
  [BaseType.CURRENCY]: 'dollar-sign',
  [BaseType.ADDRESS]: 'map-pin',
  [BaseType.TAGS]: 'tags',
}

/**
 * Variable type icon component
 */
export const VarTypeIcon = ({
  type,
  className,
}: {
  type: BaseType
  className?: string
}): React.ReactElement => {
  const iconId = VAR_TYPE_ICON_MAP[type] || 'box'
  const iconData = getIconData(iconId)

  if (!iconData) {
    return <Circle className={cn('size-4', className)} />
  }

  const IconComponent = iconData.icon
  return <IconComponent className={cn('size-4', className)} />
}

/**
 * Get display name for variable type
 */
export const getVarTypeName = (type: BaseType): string => {
  switch (type) {
    case BaseType.STRING:
      return 'String'
    case BaseType.NUMBER:
      return 'Number'
    case BaseType.BOOLEAN:
      return 'Boolean'
    case BaseType.OBJECT:
      return 'Object'
    case BaseType.ARRAY:
      return 'Array'
    case BaseType.DATE:
      return 'Date'
    case BaseType.DATETIME:
      return 'Date Time'
    case BaseType.TIME:
      return 'Time'
    case BaseType.FILE:
      return 'File'
    case BaseType.EMAIL:
      return 'Email'
    case BaseType.URL:
      return 'URL'
    case BaseType.PHONE:
      return 'Phone'
    case BaseType.ENUM:
      return 'Enum'
    case BaseType.JSON:
      return 'JSON'
    case BaseType.REFERENCE:
      return 'Reference'
    case BaseType.RELATION:
      return 'Relation'
    case BaseType.SECRET:
      return 'Secret'
    case BaseType.ANY:
      return 'Any'
    case BaseType.NULL:
      return 'Null'
    case BaseType.CURRENCY:
      return 'Currency'
    case BaseType.ADDRESS:
      return 'Address'
    case BaseType.TAGS:
      return 'Tags'
    default:
      return type // Return the raw type if unknown
  }
}
