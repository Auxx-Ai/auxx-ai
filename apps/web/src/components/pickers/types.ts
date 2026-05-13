// apps/web/src/components/pickers/types.ts

import type { RecordId } from '@auxx/lib/resources/client'

/**
 * Shared props for picker-content components that participate in
 * ReferencePickerContent's tab strip. Each tab content shares a single
 * upstream CommandInput (`externalSearch`) and emits RecordIds.
 */
export interface SharedPickerContentProps {
  /** Currently-selected RecordIds */
  value: RecordId[]
  /** Called when selection changes */
  onChange: (selected: RecordId[]) => void
  /** Multi-select mode (default true) */
  multi?: boolean
  /** Single-select callback fired alongside onChange */
  onSelectSingle?: (id: RecordId) => void
  /** Forwarded by ReferencePickerContent; the upstream query string */
  externalSearch?: string
  /** Whether to render the internal search input. Default: true. */
  showInput?: boolean
  /** Capture state for arrow-key wiring */
  onCaptureChange?: (capturing: boolean) => void
  /** Search placeholder (only shown when showInput is true) */
  placeholder?: string
  /** Disabled */
  disabled?: boolean
  /** Optional className */
  className?: string
}
