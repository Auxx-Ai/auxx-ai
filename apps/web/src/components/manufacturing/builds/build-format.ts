// apps/web/src/components/manufacturing/builds/build-format.ts

import {
  BuildSource,
  type BuildSourceValue,
  BuildStatus,
  type BuildStatusValue,
} from '@auxx/lib/inventory/builds/client'
import type { Variant } from '@auxx/ui/components/badge'

export const BUILD_STATUS_LABEL = Object.fromEntries(
  BuildStatus.values.map((option) => [option.value, option.label])
) as Record<BuildStatusValue, string>

export const BUILD_STATUS_VARIANT = Object.fromEntries(
  BuildStatus.values.map((option) => [option.value, option.color as Variant])
) as Record<BuildStatusValue, Variant>

export const BUILD_SOURCE_LABEL = Object.fromEntries(
  BuildSource.values.map((option) => [option.value, option.label])
) as Record<BuildSourceValue, string>

/** Trim a quantity's trailing zeros, and read absence as a dash rather than zero. */
export function formatBuildQuantity(value: number | null | undefined): string {
  if (value == null) return '—'
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}
