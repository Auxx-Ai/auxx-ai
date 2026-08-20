// apps/web/src/components/workflow/nodes/core/crud/components/default-values-editor.tsx

'use client'

import type React from 'react'
import { ErrorDefaultValuesEditor } from '~/components/workflow/nodes/shared/error-default-values-editor'
import type { CrudDefaultValue } from '../types'

interface DefaultValuesEditorProps {
  defaultValues: CrudDefaultValue[]
  onChange: (values: CrudDefaultValue[]) => void
}

/**
 * Component for editing default values in CRUD nodes.
 * Used when error strategy is set to 'default'.
 *
 * The implementation moved to `nodes/shared/error-default-values-editor.tsx`
 * unchanged when the `ai` node opted into the `default` policy and needed the
 * same control — it was already generic over `{ key, type, value }`. This stays
 * as crud's typed entry point so no crud caller churns; plan 24, which owns the
 * defaults-editor redesign, has one implementation to replace rather than two.
 */
export const DefaultValuesEditor: React.FC<DefaultValuesEditorProps> = ({
  defaultValues,
  onChange,
}) => <ErrorDefaultValuesEditor defaultValues={defaultValues} onChange={onChange} />
