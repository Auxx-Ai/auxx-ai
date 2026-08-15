// apps/web/src/components/workflow/utils/icon-helper.tsx

import { VAR_TYPE_ICON_MAP } from '@auxx/lib/workflow-engine/client'
import { getIcon as getIconData } from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'
import { Circle } from 'lucide-react'
import type React from 'react'
import { brandIconSrc, parseVisualRef } from '~/components/icons/ui/visual-icon'
import { BaseType } from '../types/unified-types'

/**
 * Get an icon component by name.
 * Supports Lucide icon IDs, prefixed URLs, prefixed base64, brand marks, and emojis.
 */
export const getIcon = (
  iconName: string,
  className: string = 'size-4',
  style?: React.CSSProperties
): React.ReactElement => {
  const parsed = parseVisualRef(iconName)

  switch (parsed?.type) {
    case 'url':
    case 'base64':
      return (
        <img
          src={parsed.value}
          alt=''
          className={className}
          style={{ objectFit: 'contain', ...style }}
          draggable={false}
        />
      )
    case 'brand':
      return (
        <img
          src={brandIconSrc(parsed.slug)}
          alt=''
          className={className}
          style={{ objectFit: 'contain', ...style }}
          draggable={false}
        />
      )
    case 'emoji':
      return (
        <span className={className} style={style}>
          {parsed.value}
        </span>
      )
    case 'icon':
    case 'lucide': {
      const iconId = parsed.type === 'icon' ? parsed.iconId : parsed.value
      const iconData = getIconData(iconId)
      if (!iconData) {
        console.warn(`Icon not found: ${iconId}, using fallback`)
        return <Circle className={className} style={style} />
      }
      const IconComponent = iconData.icon
      return <IconComponent className={className} style={style} />
    }
    default:
      return <Circle className={className} style={style} />
  }
}

/**
 * Variable type icon mapping to new icon system.
 *
 * Moved to the node catalog (`@auxx/lib/workflow-engine/catalog/type-icons`) so
 * `form-input`'s manifest `getIcon` — which resolves an icon NAME from the
 * node's `inputType` — reads the same map the builder does. Re-exported here so
 * no consumer import churns.
 */
export { VAR_TYPE_ICON_MAP }

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
    case BaseType.ACTOR:
      return 'Actor'
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
