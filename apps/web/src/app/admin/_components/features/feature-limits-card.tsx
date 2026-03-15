// apps/web/src/app/admin/_components/features/feature-limits-card.tsx
/**
 * Consolidated feature limits card — gates, static limits, and usage limits
 * in a single table with section header rows. Shared between plan editing and per-org overrides.
 */
'use client'

import type { FeatureDefinition, FeatureLimit } from '@auxx/lib/permissions/client'
import { FEATURE_REGISTRY, USAGE_METRICS } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import { Switch } from '@auxx/ui/components/switch'
import { Table, TableBody, TableCell, TableRow } from '@auxx/ui/components/table'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'

interface FeatureLimitsCardProps {
  limits: FeatureDefinition[]
  onChange: (limits: FeatureDefinition[]) => void
  planDefaults?: FeatureDefinition[]
  /** When true, features inherit from planDefaults and changes are overrides */
  overrideMode?: boolean
}

const BOOLEAN_FEATURES = FEATURE_REGISTRY.filter((f) => f.type === 'boolean')
const STATIC_FEATURES = FEATURE_REGISTRY.filter((f) => f.type === 'static')
const ALL_KNOWN_KEYS = new Set(FEATURE_REGISTRY.map((f) => f.key))

function getUsageGroups() {
  return USAGE_METRICS.map((metric) => {
    const features = FEATURE_REGISTRY.filter((f) => f.type === 'usage' && f.metric === metric)
    const hard = features.find((f) => f.variant === 'hard')!
    const soft = features.find((f) => f.variant === 'soft')!
    return { metric, label: hard.label, unit: hard.unit, hard, soft }
  })
}

const USAGE_GROUPS = getUsageGroups()

const ROW = '*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'
const LABEL = 'bg-muted/50 py-2 font-medium'
const SECTION_ROW = 'hover:bg-transparent'

export function FeatureLimitsCard({
  limits,
  onChange,
  planDefaults,
  overrideMode,
}: FeatureLimitsCardProps) {
  const [customKey, setCustomKey] = useState('')
  const [customLimit, setCustomLimit] = useState<number>(0)

  const defaultsMap = new Map(planDefaults?.map((d) => [d.key, d.limit]))

  // ── Helpers ──

  const getDefault = (key: string): FeatureLimit | undefined => {
    return defaultsMap.get(key)
  }

  const getBooleanLimit = (key: string): boolean => {
    return limits.find((l) => l.key === key)?.limit === true
  }

  const getNumericLimit = (key: string): number | undefined => {
    const val = limits.find((l) => l.key === key)?.limit
    return typeof val === 'number' ? val : undefined
  }

  const isConfigured = (key: string): boolean => {
    return limits.some((l) => l.key === key)
  }

  const isOverridden = (key: string): boolean => {
    return overrideMode === true && isConfigured(key)
  }

  const updateBooleanLimit = (key: string, checked: boolean) => {
    const existing = limits.find((l) => l.key === key)
    if (existing) {
      onChange(limits.map((l) => (l.key === key ? { ...l, limit: checked } : l)))
    } else {
      onChange([...limits, { key, limit: checked }])
    }
  }

  const updateNumericLimit = (key: string, value: number) => {
    const existing = limits.find((l) => l.key === key)
    if (existing) {
      onChange(limits.map((l) => (l.key === key ? { ...l, limit: value } : l)))
    } else {
      onChange([...limits, { key, limit: value }])
    }
  }

  const enableLimit = (key: string) => {
    onChange([...limits, { key, limit: 0 }])
  }

  const removeLimit = (key: string) => {
    onChange(limits.filter((l) => l.key !== key))
  }

  const toggleUnlimited = (key: string) => {
    const current = getNumericLimit(key)
    updateNumericLimit(key, current === -1 ? 0 : -1)
  }

  const enableMetric = (hardKey: string, softKey: string) => {
    const newLimits = [...limits]
    if (!isConfigured(hardKey)) newLimits.push({ key: hardKey, limit: 0 })
    if (!isConfigured(softKey)) newLimits.push({ key: softKey, limit: 0 })
    onChange(newLimits)
  }

  const removeMetric = (hardKey: string, softKey: string) => {
    onChange(limits.filter((l) => l.key !== hardKey && l.key !== softKey))
  }

  const addCustomLimit = () => {
    if (customKey.trim() && !limits.find((l) => l.key === customKey)) {
      onChange([...limits, { key: customKey.trim(), limit: customLimit }])
      setCustomKey('')
      setCustomLimit(0)
    }
  }

  const resetLabel = overrideMode ? 'Use Default' : 'Reset'

  /** Format a plan default value for display */
  const formatDefault = (val: FeatureLimit | undefined): string => {
    if (val === undefined) return 'N/A'
    if (val === true) return 'On'
    if (val === false) return 'Off'
    if (val === -1 || val === '+') return 'Unlimited'
    return String(val)
  }

  /** Inherited badge shown in override mode when a feature is not overridden */
  const InheritedBadge = ({ value }: { value: FeatureLimit | undefined }) =>
    overrideMode && value !== undefined ? (
      <Badge variant='outline' className='text-xs text-muted-foreground font-normal'>
        Plan default: {formatDefault(value)}
      </Badge>
    ) : null

  /** Override badge shown when value differs from plan default */
  const OverrideBadge = ({ featureKey }: { featureKey: string }) =>
    isOverridden(featureKey) ? (
      <Badge variant='secondary' className='text-xs'>
        Override
      </Badge>
    ) : null

  const customLimits = limits.filter((l) => !ALL_KNOWN_KEYS.has(l.key))

  return (
    <Card className='border-none rounded-none shadow-none'>
      <CardHeader>
        <CardTitle>Feature Limits</CardTitle>
        <CardDescription>Gates, static limits, and usage quotas</CardDescription>
      </CardHeader>
      <CardContent>
        <div className='overflow-hidden rounded-md border bg-background'>
          <Table>
            <TableBody>
              {/* ── Feature Gates ── */}
              <TableRow className={SECTION_ROW}>
                <TableCell
                  colSpan={2}
                  className='bg-muted/50 py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground'>
                  Feature Gates
                </TableCell>
              </TableRow>
              {BOOLEAN_FEATURES.map(({ key, label }) => {
                const configured = isConfigured(key)
                const defaultVal = getDefault(key)
                const effectiveValue = configured ? getBooleanLimit(key) : defaultVal === true

                return (
                  <TableRow key={key} className={ROW}>
                    <TableCell className={LABEL}>
                      <div className='flex items-center gap-2'>
                        <span>{label}</span>
                        <OverrideBadge featureKey={key} />
                      </div>
                    </TableCell>
                    <TableCell className='py-2'>
                      <div className='flex items-center gap-2'>
                        <Switch
                          size='sm'
                          checked={effectiveValue}
                          className={!configured && overrideMode ? 'opacity-50' : undefined}
                          onCheckedChange={(checked) => updateBooleanLimit(key, checked)}
                        />
                        {!configured && overrideMode ? (
                          <InheritedBadge value={defaultVal} />
                        ) : configured && overrideMode ? (
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            className='ml-auto text-muted-foreground'
                            onClick={() => removeLimit(key)}>
                            {resetLabel}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}

              {/* ── Static Limits ── */}
              <TableRow className={SECTION_ROW}>
                <TableCell
                  colSpan={2}
                  className='bg-muted/50 py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground'>
                  Static Limits
                </TableCell>
              </TableRow>
              {STATIC_FEATURES.map(({ key, label, unit }) => {
                const configured = isConfigured(key)
                const value = getNumericLimit(key)
                const isUnlimited = value === -1
                const defaultVal = getDefault(key)
                const showInherited = !configured && overrideMode && defaultVal !== undefined

                return (
                  <TableRow key={key} className={ROW}>
                    <TableCell className={LABEL}>
                      <div className='flex flex-col'>
                        <div className='flex items-center gap-2'>
                          <span>{label}</span>
                          <OverrideBadge featureKey={key} />
                        </div>
                        {unit && (
                          <span className='text-xs font-normal text-muted-foreground'>{unit}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className='py-2'>
                      {showInherited ? (
                        <div className='flex items-center gap-2'>
                          <span className='text-sm text-muted-foreground'>
                            {formatDefault(defaultVal)}
                          </span>
                          <InheritedBadge value={defaultVal} />
                          <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            className='ml-auto'
                            onClick={() => enableLimit(key)}>
                            Override
                          </Button>
                        </div>
                      ) : !configured ? (
                        <div className='flex items-center gap-2'>
                          <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => enableLimit(key)}>
                            Enable
                          </Button>
                        </div>
                      ) : (
                        <div className='flex items-center gap-2'>
                          {isUnlimited ? (
                            <Button
                              type='button'
                              variant='secondary'
                              size='sm'
                              onClick={() => toggleUnlimited(key)}>
                              Unlimited
                            </Button>
                          ) : (
                            <InputGroup className='w-40'>
                              <InputGroupInput
                                type='number'
                                value={value ?? 0}
                                onChange={(e) =>
                                  updateNumericLimit(key, Number.parseInt(e.target.value, 10) || 0)
                                }
                              />
                              <InputGroupAddon align='inline-end'>
                                <InputGroupButton
                                  type='button'
                                  size='icon-xs'
                                  onClick={() => toggleUnlimited(key)}>
                                  ∞
                                </InputGroupButton>
                              </InputGroupAddon>
                            </InputGroup>
                          )}
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            className='ml-auto text-muted-foreground'
                            onClick={() => removeLimit(key)}>
                            {resetLabel}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}

              {/* ── Usage Limits ── */}
              <TableRow className={SECTION_ROW}>
                <TableCell
                  colSpan={2}
                  className='bg-muted/50 py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground'>
                  Usage Limits
                </TableCell>
              </TableRow>
              {USAGE_GROUPS.map(({ metric, label, unit, hard, soft }) => {
                const metricConfigured = isConfigured(hard.key) || isConfigured(soft.key)
                const hardValue = getNumericLimit(hard.key)
                const hardIsUnlimited = hardValue === -1
                const hardDefault = getDefault(hard.key)
                const softDefault = getDefault(soft.key)
                const showInherited = !metricConfigured && overrideMode && hardDefault !== undefined

                return (
                  <TableRow key={metric} className={ROW}>
                    <TableCell className={`${LABEL} align-top`}>
                      <div className='flex flex-col'>
                        <div className='flex items-center gap-2'>
                          <span>{label}</span>
                          {(isOverridden(hard.key) || isOverridden(soft.key)) && (
                            <Badge variant='secondary' className='text-xs'>
                              Override
                            </Badge>
                          )}
                        </div>
                        {unit && (
                          <span className='text-xs font-normal text-muted-foreground'>{unit}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className='py-2'>
                      {showInherited ? (
                        <div className='flex items-center gap-2'>
                          <span className='text-sm text-muted-foreground'>
                            Hard: {formatDefault(hardDefault)}
                            {softDefault !== undefined && ` / Soft: ${formatDefault(softDefault)}`}
                          </span>
                          <InheritedBadge value={hardDefault} />
                          <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            className='ml-auto'
                            onClick={() => enableMetric(hard.key, soft.key)}>
                            Override
                          </Button>
                        </div>
                      ) : !metricConfigured ? (
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          onClick={() => enableMetric(hard.key, soft.key)}>
                          Enable
                        </Button>
                      ) : (
                        <div className='space-x-1.5 flex flex-row items-center'>
                          {/* Hard */}
                          {hardIsUnlimited ? (
                            <Button
                              type='button'
                              variant='secondary'
                              size='sm'
                              onClick={() => toggleUnlimited(hard.key)}>
                              Unlimited
                            </Button>
                          ) : (
                            <InputGroup className='w-40'>
                              <InputGroupAddon align='inline-start'>
                                <InputGroupText>Hard</InputGroupText>
                              </InputGroupAddon>
                              <InputGroupInput
                                type='number'
                                value={hardValue ?? 0}
                                onChange={(e) =>
                                  updateNumericLimit(
                                    hard.key,
                                    Number.parseInt(e.target.value, 10) || 0
                                  )
                                }
                              />
                              <InputGroupAddon align='inline-end'>
                                <InputGroupButton
                                  type='button'
                                  size='icon-xs'
                                  onClick={() => toggleUnlimited(hard.key)}>
                                  ∞
                                </InputGroupButton>
                              </InputGroupAddon>
                            </InputGroup>
                          )}
                          {/* Soft — hidden when hard is unlimited */}
                          {!hardIsUnlimited && (
                            <div className='flex items-center gap-2'>
                              <InputGroup>
                                <InputGroupAddon align='inline-start'>
                                  <InputGroupText>Soft</InputGroupText>
                                </InputGroupAddon>
                                <InputGroupInput
                                  type='number'
                                  value={getNumericLimit(soft.key) ?? 0}
                                  onChange={(e) =>
                                    updateNumericLimit(
                                      soft.key,
                                      Number.parseInt(e.target.value, 10) || 0
                                    )
                                  }
                                  className='w-24'
                                />
                              </InputGroup>
                            </div>
                          )}
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            className='ml-auto text-muted-foreground'
                            onClick={() => removeMetric(hard.key, soft.key)}>
                            {resetLabel}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}

              {/* ── Custom Limits ── */}
              {customLimits.length > 0 && (
                <>
                  <TableRow className={SECTION_ROW}>
                    <TableCell
                      colSpan={2}
                      className='bg-muted/50 py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground'>
                      Custom Limits
                    </TableCell>
                  </TableRow>
                  {customLimits.map((limit) => (
                    <TableRow key={limit.key} className={ROW}>
                      <TableCell className={LABEL}>
                        <span className='font-mono text-sm'>{limit.key}</span>
                      </TableCell>
                      <TableCell className='py-2'>
                        <div className='flex items-center gap-2'>
                          <Input
                            type='number'
                            value={typeof limit.limit === 'number' ? limit.limit : 0}
                            onChange={(e) =>
                              updateNumericLimit(
                                limit.key,
                                Number.parseInt(e.target.value, 10) || 0
                              )
                            }
                            className='w-24 h-8 text-sm'
                          />
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-sm'
                            onClick={() => removeLimit(limit.key)}>
                            <X />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Add custom limit — below the table */}
        <div className='mt-3'>
          <span className='text-xs font-medium text-muted-foreground'>Add Custom Limit</span>
          <div className='flex items-center gap-2 mt-1'>
            <Input
              value={customKey}
              onChange={(e) => setCustomKey(e.target.value)}
              placeholder='customKey'
              className='flex-1 h-8 text-sm'
            />
            <Input
              type='number'
              value={customLimit}
              onChange={(e) => setCustomLimit(Number.parseInt(e.target.value, 10) || 0)}
              placeholder='0'
              className='w-24 h-8 text-sm'
            />
            <Button type='button' onClick={addCustomLimit} size='sm'>
              <Plus />
              Add
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
