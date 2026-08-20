// apps/web/src/components/workflow/nodes/core/http/components/error-handling.tsx

'use client'

import { getHttpOutputVariables, getManifest } from '@auxx/lib/workflow-engine/client'
import { useCallback, useMemo } from 'react'
import { DefaultValuesEditor } from '~/components/workflow/nodes/shared/default-values-editor'
import {
  ErrorHandlingSection,
  type ErrorStrategyUpdate,
} from '~/components/workflow/nodes/shared/error-handling-section'
import type { DefaultValueItem, HttpNodeData } from '../types'

interface ErrorHandlingProps {
  nodeId: string
  isReadOnly: boolean
  config: HttpNodeData
  onChange: (updates: Partial<HttpNodeData>) => void
}

/**
 * http's failure-policy panel.
 *
 * The strategy selector is the shared `ErrorHandlingSection` (plan 21 §15.4)
 * and the substitutes editor is now the shared `DefaultValuesEditor` (plan 24
 * §10.3) — so this file owns nothing but the wiring between them.
 *
 * What it USED to own was a fixed three-field form — Status Code, Response
 * Body, Response Headers — with keys hard-coded as `status_code` / `headers` /
 * `body`, no way to add or remove a row, and an upsert-only writer. Two of
 * those three keys were wrong and the third was shadowed:
 * `processDefaultValues` filed every key under `result.body[key]`, so the
 * Status Code control set `body.status_code` — a path declared nowhere — while
 * `{{Http.status}}` stayed hard-coded at 200 (plan 24 §9.1).
 *
 * Drawing the keys from `resolveOutputs` fixes that mechanically rather than
 * by patching the three handlers: the picked key IS the declared output path,
 * so `status` reaches `status`. The three fields are still reachable — they
 * are three of the six entries in the picker — alongside `success`, `error`
 * and `response`, which the old form could not express at all.
 */
export function ErrorHandling({ nodeId, isReadOnly, config, onChange }: ErrorHandlingProps) {
  const handleStrategyChange = useCallback(
    (update: ErrorStrategyUpdate) => onChange(update as Partial<HttpNodeData>),
    [onChange]
  )

  const handleDefaultValuesChange = useCallback(
    (values: DefaultValueItem[]) => onChange({ default_values: values }),
    [onChange]
  )

  // http's resolver is pure — no resource, no org cache — so the targets need
  // nothing but the node's own data.
  const outputVariables = useMemo(() => getHttpOutputVariables(config, nodeId), [config, nodeId])

  return (
    <ErrorHandlingSection
      nodeId={nodeId}
      nodeType='http'
      errorStrategy={config?.error_strategy}
      onChange={handleStrategyChange}>
      <DefaultValuesEditor
        nodeId={nodeId}
        declaredOutputs={outputVariables}
        errorHandling={getManifest('http')?.errorHandling}
        // The legacy singular key is still on stored graphs until plan 21
        // §19's migration runs; reading both keeps those nodes editable.
        values={config?.default_values ?? config?.default_value ?? []}
        onChange={handleDefaultValuesChange}
        isReadOnly={isReadOnly}
      />
    </ErrorHandlingSection>
  )
}
