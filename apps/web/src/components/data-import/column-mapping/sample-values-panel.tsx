// apps/web/src/components/data-import/column-mapping/sample-values-panel.tsx

'use client'

import { FileText } from 'lucide-react'
import type { ColumnMappingUI } from '../types'

interface SampleValuesPanelProps {
  mapping: ColumnMappingUI | undefined
}

/**
 * Right-side panel showing sample values for the hovered column.
 * Displays placeholder when no column is hovered.
 */
export function SampleValuesPanel({ mapping }: SampleValuesPanelProps) {
  if (!mapping) {
    return (
      <div className="border rounded-lg p-4 bg-muted/30 flex flex-col items-center justify-center text-center h-full min-h-[200px]">
        <FileText className="size-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">Select a column to see sample values</p>
      </div>
    )
  }

  return (
    <div className="border rounded-lg overflow-hidden h-fit sticky top-16">
      {/* Header */}
      <div className="px-3 py-1 bg-primary-200/50 border-b">
        <p className="font-medium text-sm">{mapping.columnName}</p>
        <p className="text-xs text-muted-foreground">{mapping.sampleValues.length} sample values</p>
      </div>

      {/* Sample values list */}
      <div className="p-2 max-h-[400px] overflow-y-auto">
        {mapping.sampleValues.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-sm text-muted-foreground">No sample values available</p>
            <p className="text-xs text-muted-foreground mt-1">Data may still be uploading</p>
          </div>
        ) : (
          <div className="space-y-1">
            {mapping.sampleValues.map((value, i) => (
              <div
                key={i}
                className="px-3 py-2 rounded-md bg-muted/30 text-sm font-mono truncate"
                title={value}>
                {value || <span className="text-muted-foreground italic">empty</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
