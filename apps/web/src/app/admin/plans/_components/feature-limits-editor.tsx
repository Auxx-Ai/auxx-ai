// apps/web/src/app/admin/plans/_components/feature-limits-editor.tsx
/**
 * Component for editing feature limits (boolean gates, static limits, usage limits)
 */
'use client'

import type { FeatureLimit } from '@auxx/billing'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Switch } from '@auxx/ui/components/switch'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'

/**
 * Feature limits editor props
 */
interface FeatureLimitsEditorProps {
  limits: FeatureLimit[]
  onChange: (limits: FeatureLimit[]) => void
}

/**
 * Predefined feature keys grouped by type
 */
const BOOLEAN_GATES = [
  { key: 'knowledgeBase', label: 'Knowledge Base' },
  { key: 'knowledgeBaseMultiple', label: 'Multiple Knowledge Bases' },
  { key: 'apiAccess', label: 'API Access' },
  { key: 'customFields', label: 'Custom Fields' },
  { key: 'workflows', label: 'Workflows' },
  { key: 'aiAgent', label: 'AI Agent' },
  { key: 'sso', label: 'SSO' },
]

const STATIC_LIMITS = [
  { key: 'teammates', label: 'Teammates' },
  { key: 'channels', label: 'Channels' },
  { key: 'rules', label: 'Rules' },
  { key: 'savedViews', label: 'Saved Views' },
  { key: 'kbPublishedArticles', label: 'KB Published Articles' },
]

const USAGE_LIMITS = [
  { key: 'outboundEmailsPerMonthHard', label: 'Outbound Emails (Hard)' },
  { key: 'outboundEmailsPerMonthSoft', label: 'Outbound Emails (Soft)' },
  { key: 'workflowRunsPerMonthHard', label: 'Workflow Runs (Hard)' },
  { key: 'workflowRunsPerMonthSoft', label: 'Workflow Runs (Soft)' },
  { key: 'aiCompletionsPerMonthHard', label: 'AI Completions (Hard)' },
  { key: 'aiCompletionsPerMonthSoft', label: 'AI Completions (Soft)' },
  { key: 'apiCallsPerMonthHard', label: 'API Calls (Hard)' },
  { key: 'apiCallsPerMonthSoft', label: 'API Calls (Soft)' },
  { key: 'storageGbHard', label: 'Storage GB (Hard)' },
  { key: 'storageGbSoft', label: 'Storage GB (Soft)' },
]

const ALL_PREDEFINED_KEYS = new Set([
  ...BOOLEAN_GATES.map((k) => k.key),
  ...STATIC_LIMITS.map((k) => k.key),
  ...USAGE_LIMITS.map((k) => k.key),
])

/**
 * Component for editing feature limits
 */
export function FeatureLimitsEditor({ limits, onChange }: FeatureLimitsEditorProps) {
  const [customKey, setCustomKey] = useState('')
  const [customLimit, setCustomLimit] = useState<number>(0)

  /**
   * Update limit value for a key (number or boolean)
   */
  const updateLimit = (key: string, limit: number | boolean) => {
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
   * Get numeric limit value for a key
   */
  const getNumericLimit = (key: string): number => {
    const val = limits.find((l) => l.key === key)?.limit
    return typeof val === 'number' ? val : 0
  }

  /**
   * Get boolean limit value for a key
   */
  const getBooleanLimit = (key: string): boolean => {
    const val = limits.find((l) => l.key === key)?.limit
    return val === true
  }

  return (
    <div className='space-y-6'>
      {/* Boolean gates */}
      <div>
        <p className='text-sm font-medium mb-3'>Feature Gates</p>
        <div className='grid grid-cols-2 gap-3'>
          {BOOLEAN_GATES.map(({ key, label }) => (
            <div key={key} className='flex items-center justify-between p-2 rounded-md border'>
              <label className='text-sm'>{label}</label>
              <Switch
                checked={getBooleanLimit(key)}
                onCheckedChange={(checked) => updateLimit(key, checked)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Static limits */}
      <div>
        <p className='text-sm font-medium mb-3'>Static Limits</p>
        <div className='grid grid-cols-2 gap-4'>
          {STATIC_LIMITS.map(({ key, label }) => (
            <div key={key} className='space-y-2'>
              <label className='text-sm'>{label}</label>
              <div className='flex items-center gap-2'>
                <Input
                  type='number'
                  value={getNumericLimit(key)}
                  onChange={(e) => updateLimit(key, Number.parseInt(e.target.value, 10) || 0)}
                  placeholder='0'
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => removeLimit(key)}
                  disabled={!limits.find((l) => l.key === key)}>
                  <X />
                </Button>
              </div>
              <p className='text-xs text-muted-foreground'>-1 = unlimited</p>
            </div>
          ))}
        </div>
      </div>

      {/* Usage limits (per month) */}
      <div>
        <p className='text-sm font-medium mb-3'>Usage Limits (per month)</p>
        <div className='grid grid-cols-2 gap-4'>
          {USAGE_LIMITS.map(({ key, label }) => (
            <div key={key} className='space-y-2'>
              <label className='text-sm'>{label}</label>
              <div className='flex items-center gap-2'>
                <Input
                  type='number'
                  value={getNumericLimit(key)}
                  onChange={(e) => updateLimit(key, Number.parseInt(e.target.value, 10) || 0)}
                  placeholder='0'
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => removeLimit(key)}
                  disabled={!limits.find((l) => l.key === key)}>
                  <X />
                </Button>
              </div>
              <p className='text-xs text-muted-foreground'>-1 = unlimited, 0 = disabled</p>
            </div>
          ))}
        </div>
      </div>

      {/* Custom limits (keys not in predefined lists) */}
      {limits.filter((l) => !ALL_PREDEFINED_KEYS.has(l.key)).length > 0 && (
        <div>
          <p className='text-sm font-medium mb-3'>Custom Limits</p>
          {limits
            .filter((l) => !ALL_PREDEFINED_KEYS.has(l.key))
            .map((limit) => (
              <div key={limit.key} className='flex items-center gap-2 p-2 bg-muted rounded-md mb-2'>
                <span className='flex-1 text-sm font-medium'>{limit.key}</span>
                <Input
                  type='number'
                  value={typeof limit.limit === 'number' ? limit.limit : 0}
                  onChange={(e) => updateLimit(limit.key, Number.parseInt(e.target.value, 10) || 0)}
                  className='w-24'
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => removeLimit(limit.key)}>
                  <X />
                </Button>
              </div>
            ))}
        </div>
      )}

      {/* Add custom limit */}
      <div className='pt-4 border-t'>
        <p className='text-sm font-medium mb-2'>Add Custom Limit</p>
        <div className='flex items-center gap-2'>
          <Input
            value={customKey}
            onChange={(e) => setCustomKey(e.target.value)}
            placeholder='customKey'
            className='flex-1'
          />
          <Input
            type='number'
            value={customLimit}
            onChange={(e) => setCustomLimit(Number.parseInt(e.target.value, 10) || 0)}
            placeholder='0'
            className='w-24'
          />
          <Button type='button' onClick={addCustomLimit} size='sm'>
            <Plus />
            Add
          </Button>
        </div>
      </div>
    </div>
  )
}
