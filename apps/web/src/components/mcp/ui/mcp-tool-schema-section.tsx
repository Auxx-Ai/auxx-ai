// apps/web/src/components/mcp/ui/mcp-tool-schema-section.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { FileCheck2, Pencil, RotateCcw, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import {
  SchemaEditorDialog,
  type SeededFrom,
} from '~/components/schema-editor/ui/schema-editor-dialog'
import { api } from '~/trpc/react'
import type { McpDetailServer } from './mcp-server-detail'
import type { McpToolRunSuccess } from './mcp-tool-run-panel'

type McpTool = McpDetailServer['tools'][number]

interface McpToolSchemaSectionProps {
  serverId: string
  tool: McpTool
  /** Latest successful run, if any — enables "Generate from result" + "Save as example". */
  lastResult: McpToolRunSuccess | null
  onChanged: () => void
}

const EMPTY_SCHEMA = { type: 'object', properties: {} }

const SOURCE_LABEL: Record<NonNullable<McpTool['outputSchemaSource']>, string> = {
  server: 'Server',
  inferred: 'Inferred',
  manual: 'Manual',
}

/**
 * Output-schema section of the tool panel: a provenance badge (Server / Inferred / Manual / None),
 * Edit + Reset, and — after a test run — "Generate from result" and "Save as example output".
 * A successful run on a tool with NO schema auto-sets the inferred schema (`source: 'inferred'`) +
 * example silently. Editing opens the shared `SchemaEditorDialog` (`emitRequired: false`,
 * `root: 'any'` so array/scalar result roots are editable); saves persist via `mcp.updateToolSchema`.
 */
export function McpToolSchemaSection({
  serverId,
  tool,
  lastResult,
  onChanged,
}: McpToolSchemaSectionProps) {
  const [seed, setSeed] = useState<{
    schema: Record<string, unknown>
    seededFrom: SeededFrom
  } | null>(null)
  const updateSchema = api.mcp.updateToolSchema.useMutation()

  const hasSchema = !!tool.outputSchema
  const badgeLabel = hasSchema
    ? (SOURCE_LABEL[tool.outputSchemaSource ?? 'manual'] ?? 'Manual')
    : 'None'

  // The editor now accepts any root (MCP passes `root: 'any'`), so "Generate from
  // result" is offered whenever a run produced an inferred schema — object, array,
  // or scalar.
  const canGenerate = !!lastResult?.inferredSchema

  const persist = useCallback(
    async (
      args: Parameters<typeof updateSchema.mutateAsync>[0],
      failTitle: string
    ): Promise<boolean> => {
      try {
        const res = await updateSchema.mutateAsync(args)
        if (!res.ok) {
          toastError({ title: failTitle, description: res.error ?? 'Unknown error' })
          return false
        }
        onChanged()
        return true
      } catch (err) {
        toastError({
          title: failTitle,
          description: err instanceof Error ? err.message : 'Unknown error',
        })
        return false
      }
    },
    [updateSchema, onChanged]
  )

  // Auto-set on test run: when a run produces a result and the tool has NO schema
  // yet, silently persist the inferred schema (`source: 'inferred'`) + the example
  // in one call. Only when none exists — never touches server/manual/inferred. The
  // ref guards against re-firing for the same result across re-renders.
  const autoSetFor = useRef<McpToolRunSuccess | null>(null)
  useEffect(() => {
    if (!lastResult || hasSchema || !lastResult.inferredSchema) return
    if (autoSetFor.current === lastResult) return
    autoSetFor.current = lastResult
    void persist(
      {
        serverId,
        toolName: tool.name,
        outputSchema: lastResult.inferredSchema as Record<string, unknown>,
        source: 'inferred',
        exampleOutput: exampleFromResult(lastResult),
      },
      'Failed to save inferred schema'
    )
  }, [lastResult, hasSchema, serverId, tool.name, persist])

  function openEdit() {
    setSeed({
      schema: (tool.outputSchema as Record<string, unknown>) ?? EMPTY_SCHEMA,
      // Seed as 'inferred' when the stored schema is the unmodified inference, so a
      // no-op edit-save round-trips back to `inferred` instead of flipping to manual.
      seededFrom: hasSchema
        ? tool.outputSchemaSource === 'inferred'
          ? 'inferred'
          : 'existing'
        : 'empty',
    })
  }

  function openGenerate() {
    if (!lastResult?.inferredSchema) return
    setSeed({
      schema: lastResult.inferredSchema as Record<string, unknown>,
      seededFrom: 'inferred',
    })
  }

  async function handleSave(schema: Record<string, unknown>, source: 'inferred' | 'manual') {
    await persist(
      { serverId, toolName: tool.name, outputSchema: schema, source },
      'Failed to save schema'
    )
  }

  async function handleReset() {
    await persist({ serverId, toolName: tool.name, outputSchema: null }, 'Failed to reset schema')
  }

  async function handleSaveExample() {
    if (!lastResult) return
    await persist(
      { serverId, toolName: tool.name, exampleOutput: exampleFromResult(lastResult) },
      'Failed to save example'
    )
  }

  async function handleClearExample() {
    await persist(
      { serverId, toolName: tool.name, clearExampleOutput: true },
      'Failed to clear example'
    )
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <span className='font-medium text-foreground text-sm'>Output schema</span>
          <Badge variant='outline' size='sm'>
            {badgeLabel}
          </Badge>
        </div>
        <div className='flex items-center gap-1'>
          {canGenerate && (
            <Button variant='ghost' size='xs' onClick={openGenerate}>
              <Sparkles />
              Generate
            </Button>
          )}
          <Button variant='ghost' size='xs' onClick={openEdit}>
            <Pencil />
            Edit
          </Button>
          {hasSchema && (
            <Tooltip content='Clear schema (lets the next refresh adopt a server-declared one)'>
              <Button
                variant='ghost'
                size='icon-xs'
                onClick={handleReset}
                disabled={updateSchema.isPending}>
                <RotateCcw />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      <div className='flex items-center justify-between'>
        {tool.hasExampleOutput ? (
          <span className='flex items-center gap-1.5 text-muted-foreground text-xs'>
            <FileCheck2 className='size-3.5 text-emerald-500' />
            Example output saved
            <Tooltip content='Clear example'>
              <Button
                variant='ghost'
                size='icon-xs'
                onClick={handleClearExample}
                disabled={updateSchema.isPending}>
                <X />
              </Button>
            </Tooltip>
          </span>
        ) : (
          <span className='text-muted-foreground text-xs'>No example output saved.</span>
        )}
        {lastResult && (
          <Button
            variant='ghost'
            size='xs'
            onClick={handleSaveExample}
            disabled={updateSchema.isPending}>
            Save run as example
          </Button>
        )}
      </div>

      <SchemaEditorDialog
        open={!!seed}
        onOpenChange={(open) => !open && setSeed(null)}
        title={tool.title ?? tool.name}
        initial={seed ?? { schema: EMPTY_SCHEMA, seededFrom: 'empty' }}
        policy={{ emitRequired: false, root: 'any' }}
        onSave={handleSave}
      />
    </div>
  )
}

/** The value to persist as the tool's example: typed result, else parsed text, else raw text. */
function exampleFromResult(result: McpToolRunSuccess): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent
  try {
    return JSON.parse(result.text)
  } catch {
    return result.text
  }
}
