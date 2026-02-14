// apps/web/src/components/workflow/edges/custom-edge/linear-gradient.tsx

import React, { memo } from 'react'
import type { CustomEdgeLinearGradientProps } from './types'

export const CustomEdgeLinearGradient = memo(
  ({ id, startColor, stopColor, position }: CustomEdgeLinearGradientProps) => {
    const { x1, x2, y1, y2 } = position

    return (
      <defs>
        <linearGradient id={id} gradientUnits='userSpaceOnUse' x1={x1} y1={y1} x2={x2} y2={y2}>
          <stop
            offset='0%'
            style={{
              stopColor: startColor,
              stopOpacity: 1,
            }}
          />
          <stop
            offset='100%'
            style={{
              stopColor: stopColor,
              stopOpacity: 1,
            }}
          />
        </linearGradient>
      </defs>
    )
  }
)

CustomEdgeLinearGradient.displayName = 'CustomEdgeLinearGradient'
