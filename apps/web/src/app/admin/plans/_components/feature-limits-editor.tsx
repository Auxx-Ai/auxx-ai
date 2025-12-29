// apps/web/src/app/admin/plans/_components/feature-limits-editor.tsx
/**
 * Component for editing feature limits
 */
'use client'

import { useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Plus, X } from 'lucide-react'
import type { FeatureLimit } from '@auxx/billing'

/**
 * Feature limits editor props
 */
interface FeatureLimitsEditorProps {
  limits: FeatureLimit[]
  onChange: (limits: FeatureLimit[]) => void
}

/**
 * Predefined feature limit keys
 */
const LIMIT_KEYS = [
  { key: 'TEAMMATES', label: 'Teammates' },
  { key: 'CHANNELS', label: 'Channels' },
  { key: 'MONTHLY_EMAILS', label: 'Monthly Emails' },
  { key: 'AI_REQUESTS', label: 'AI Requests' },
]

/**
 * Component for editing feature limits
 */
export function FeatureLimitsEditor({ limits, onChange }: FeatureLimitsEditorProps) {
  const [customKey, setCustomKey] = useState('')
  const [customLimit, setCustomLimit] = useState<number>(0)

  /**
   * Update limit value for a key
   */
  const updateLimit = (key: string, limit: number) => {
    const existing = limits.find((l) => l.key === key)
    if (existing) {
      onChange(limits.map((l) => (l.key === key ? { ...l, limit } : l)))
    } else {
      onChange([...limits, { key, limit }])
    }
  }

  /**
   * Remove limit for a key
   */
  const removeLimit = (key: string) => {
    onChange(limits.filter((l) => l.key !== key))
  }

  /**
   * Add custom limit
   */
  const addCustomLimit = () => {
    if (customKey.trim() && !limits.find((l) => l.key === customKey)) {
      onChange([...limits, { key: customKey.trim(), limit: customLimit }])
      setCustomKey('')
      setCustomLimit(0)
    }
  }

  /**
   * Get limit value for a key
   */
  const getLimitValue = (key: string) => {
    return limits.find((l) => l.key === key)?.limit ?? 0
  }

  return (
    <div className="space-y-4">
      {/* Predefined limits */}
      <div className="grid grid-cols-2 gap-4">
        {LIMIT_KEYS.map(({ key, label }) => (
          <div key={key} className="space-y-2">
            <label className="text-sm font-medium">{label}</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={getLimitValue(key)}
                onChange={(e) => updateLimit(key, parseInt(e.target.value) || 0)}
                placeholder="0"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeLimit(key)}
                disabled={!limits.find((l) => l.key === key)}>
                <X />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">-1 = unlimited</p>
          </div>
        ))}
      </div>

      {/* Custom limits */}
      {limits
        .filter((l) => !LIMIT_KEYS.find((k) => k.key === l.key))
        .map((limit) => (
          <div key={limit.key} className="flex items-center gap-2 p-2 bg-muted rounded-md">
            <span className="flex-1 text-sm font-medium">{limit.key}</span>
            <Input
              type="number"
              value={limit.limit}
              onChange={(e) => updateLimit(limit.key, parseInt(e.target.value) || 0)}
              className="w-24"
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => removeLimit(limit.key)}>
              <X />
            </Button>
          </div>
        ))}

      {/* Add custom limit */}
      <div className="pt-4 border-t">
        <p className="text-sm font-medium mb-2">Add Custom Limit</p>
        <div className="flex items-center gap-2">
          <Input
            value={customKey}
            onChange={(e) => setCustomKey(e.target.value.toUpperCase().replace(/\s/g, '_'))}
            placeholder="CUSTOM_KEY"
            className="flex-1"
          />
          <Input
            type="number"
            value={customLimit}
            onChange={(e) => setCustomLimit(parseInt(e.target.value) || 0)}
            placeholder="0"
            className="w-24"
          />
          <Button type="button" onClick={addCustomLimit} size="sm">
            <Plus />
            Add
          </Button>
        </div>
      </div>
    </div>
  )
}
