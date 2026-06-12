// apps/web/src/components/mcp/ui/mcp-tool-run-panel.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { AlertTriangle, Braces, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { topLevelArgs } from '~/components/agents/ui/detail/bindings/tool-args'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { argToFieldType } from '~/lib/agents/bindings/arg-to-field-type'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import type { McpDetailServer } from './mcp-server-detail'

type McpTool = McpDetailServer['tools'][number]
type TestResult = RouterOutputs['mcp']['testTool']
export type McpToolRunSuccess = Extract<TestResult, { ok: true }>

interface McpToolRunPanelProps {
  serverId: string
  tool: McpTool
  /** Bubbles the latest successful run up so the schema section can seed Generate / Save example. */
  onResult?: (result: McpToolRunSuccess | null) => void
}

/** Pull a top-level arg's JSON-Schema `default`, if it declares one. */
function argDefault(schema: { default?: unknown }): unknown {
  return schema.default
}

/** Is a value "empty" for the purpose of omitting an optional arg from the call? */
function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === ''
}

/**
 * Test-run UI for a single MCP tool: a typed args form (reusing the bindings stack's
 * `topLevelArgs` + `argToFieldType` + `FieldInputAdapter`, minus the const/var toggle), a raw-JSON
 * escape hatch for the whole args object, a Run button gated on required args, and a result viewer
 * (Result / JSON tabs, duration, error banner). Write tools carry an inline caution.
 */
export function McpToolRunPanel({ serverId, tool, onResult }: McpToolRunPanelProps) {
  const toolArgs = useMemo(() => topLevelArgs(tool.inputSchema), [tool.inputSchema])

  // Form state: a plain `Record<argName, unknown>`, seeded from schema defaults.
  const initialValues = useMemo(() => {
    const out: Record<string, unknown> = {}
    for (const arg of toolArgs) {
      const d = argDefault(arg.schema)
      if (d !== undefined) out[arg.name] = d
    }
    return out
  }, [toolArgs])

  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [rawJson, setRawJson] = useState('{}')
  const [result, setResult] = useState<TestResult | null>(null)

  const testTool = api.mcp.testTool.useMutation()

  const requiredMissing = toolArgs.some((a) => a.required && isEmpty(values[a.name]))
  const rawParsed = mode === 'json' ? safeParseObject(rawJson) : null
  const canRun = mode === 'form' ? !requiredMissing : rawParsed.ok

  const setArg = (name: string, value: unknown) => setValues((prev) => ({ ...prev, [name]: value }))

  /** Build the args payload: form values minus empty optionals, or the parsed raw object. */
  function buildArgs(): Record<string, unknown> | null {
    if (mode === 'json') return rawParsed.ok ? rawParsed.value : null
    const out: Record<string, unknown> = {}
    for (const arg of toolArgs) {
      const v = values[arg.name]
      if (!isEmpty(v)) out[arg.name] = v
    }
    return out
  }

  async function handleRun() {
    const args = buildArgs()
    if (!args) {
      toastError({ title: 'Invalid JSON', description: 'Args must be a JSON object.' })
      return
    }
    try {
      const res = await testTool.mutateAsync({ serverId, toolName: tool.name, args })
      if (!res.ok) {
        toastError({ title: 'Tool run failed', description: res.error })
        setResult(null)
        onResult?.(null)
        return
      }
      setResult(res)
      onResult?.(res)
    } catch (err) {
      toastError({
        title: 'Tool run failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  /** Switch modes, carrying the current args across so neither view loses work. */
  function toggleMode() {
    if (mode === 'form') {
      setRawJson(JSON.stringify(buildArgs() ?? {}, null, 2))
      setMode('json')
    } else if (rawParsed.ok) {
      setValues(rawParsed.value)
      setMode('form')
    } else {
      setMode('form')
    }
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-between'>
        <div className='font-medium text-foreground text-sm'>Test run</div>
        <Button variant='ghost' size='xs' onClick={toggleMode}>
          <Braces />
          {mode === 'form' ? 'JSON' : 'Form'}
        </Button>
      </div>

      {mode === 'form' ? (
        toolArgs.length === 0 ? (
          <p className='px-2 py-3 text-muted-foreground text-xs'>This tool takes no inputs.</p>
        ) : (
          <VarEditorField className='p-0'>
            {toolArgs.map((arg) => {
              const mapped = argToFieldType(arg.schema)
              return (
                <VarEditorFieldRow
                  key={arg.name}
                  title={arg.name}
                  description={arg.schema.description}
                  isRequired={arg.required}>
                  {mapped.supported ? (
                    <FieldInputAdapter
                      fieldType={mapped.fieldType}
                      fieldOptions={mapped.options}
                      value={values[arg.name]}
                      onChange={(v) => setArg(arg.name, v)}
                      placeholder={arg.required ? 'Required' : 'Optional'}
                    />
                  ) : (
                    <Textarea
                      className='min-h-16 font-mono text-xs'
                      placeholder='JSON value'
                      value={asText(values[arg.name])}
                      onChange={(e) => setArg(arg.name, parseLooseJson(e.target.value))}
                    />
                  )}
                </VarEditorFieldRow>
              )
            })}
          </VarEditorField>
        )
      ) : (
        <Textarea
          className='min-h-40 font-mono text-xs'
          value={rawJson}
          onChange={(e) => setRawJson(e.target.value)}
          spellCheck={false}
        />
      )}

      <div className='flex flex-col gap-1.5'>
        <Button
          size='sm'
          variant='outline'
          className='self-start'
          onClick={handleRun}
          disabled={!canRun}
          loading={testTool.isPending}
          loadingText='Running...'>
          <Play />
          Run
        </Button>
        {!tool.readOnlyHint && (
          <p className='flex items-center gap-1.5 text-muted-foreground text-xs'>
            <AlertTriangle className='size-3.5 shrink-0 text-amber-500' />
            This executes against the connected account.
          </p>
        )}
      </div>

      {result?.ok && <McpToolResultView result={result} />}
    </div>
  )
}

/** Result viewer: Result/JSON tabs, duration badge, isError banner. */
function McpToolResultView({ result }: { result: Extract<TestResult, { ok: true }> }) {
  const hasJson = result.structuredContent !== undefined
  return (
    <div className='mt-1 flex flex-col gap-2 rounded-lg border bg-primary-50/40 p-2'>
      <div className='flex items-center justify-between'>
        <Badge variant={result.isError ? 'destructive' : 'outline'} size='sm'>
          {result.isError ? 'Error' : 'OK'}
        </Badge>
        <span className='text-muted-foreground text-xs'>{result.durationMs} ms</span>
      </div>

      {result.isError && (
        <div className='flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-red-700 text-xs'>
          <AlertTriangle className='mt-0.5 size-3.5 shrink-0' />
          The tool reported an error result.
        </div>
      )}

      <Tabs defaultValue={hasJson ? 'json' : 'text'}>
        <TabsList size='sm'>
          <TabsTrigger value='text'>Result</TabsTrigger>
          {hasJson && <TabsTrigger value='json'>JSON</TabsTrigger>}
        </TabsList>
        <TabsContent value='text'>
          <pre className='max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-2 font-mono text-xs'>
            {result.text || '(empty)'}
          </pre>
        </TabsContent>
        {hasJson && (
          <TabsContent value='json'>
            <pre className='max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-2 font-mono text-xs'>
              {JSON.stringify(result.structuredContent, null, 2)}
            </pre>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

function safeParseObject(
  text: string
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return { ok: true, value: parsed }
    return { ok: false }
  } catch {
    return { ok: false }
  }
}

/** Render an arbitrary value as editable text for the per-arg JSON fallback. */
function asText(v: unknown): string {
  if (v === undefined) return ''
  if (typeof v === 'string') return v
  return JSON.stringify(v, null, 2)
}

/** Parse a per-arg JSON value, falling back to the raw string when it isn't valid JSON. */
function parseLooseJson(text: string): unknown {
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
