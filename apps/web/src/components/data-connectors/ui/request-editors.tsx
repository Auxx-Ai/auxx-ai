// apps/web/src/components/data-connectors/ui/request-editors.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { generateId } from '@auxx/utils/generateId'
import { Minus, Plus } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  type HttpRequestFieldContextValue,
  HttpRequestFieldProvider,
  type KeyValue,
  KeyValueList,
  keyValueToRecord,
  PlainFieldEditor,
  recordToKeyValue,
} from '~/components/global/http-request'
import CodeEditor, { CodeLanguage } from '~/components/workflow/ui/code-editor'

/**
 * Request sub-editors for a data-connector stream (headers / query params /
 * body). They reuse the shared HTTP `KeyValueList` row config behind the plain
 * (no-workflow-variable) field editor, and the workflow `CodeEditor` for the
 * JSON body — but persist plain `Record`s (the connector's `requestConfig`
 * shape), not the workflow node's serialized string format.
 *
 * Each editor keeps its own `KeyValue[]` / text state and re-seeds only on a
 * genuine external change (mirrors `core/http/panel.tsx`) so row identity is
 * stable across keystrokes and the parent's buffered draft stays keyed by the
 * stored Record.
 */

// No workflow variables here, so override the variable-insert hint placeholders.
export const PLAIN_FIELD = {
  FieldEditor: PlainFieldEditor,
  keyPlaceholder: 'Enter key...',
  valuePlaceholder: 'Enter value...',
}

/**
 * Headers / query params — a Record-backed wrapper over the shared KeyValueList.
 *
 * `fieldContext` overrides the value editor (default: plain inputs). Webhook-sync
 * streams pass a token-aware context so values gain `{path}` steering inserts; the
 * key column stays a plain input (`keyNotSupportVar`) since header/param names are
 * static.
 */
export function RecordKeyValueEditor({
  record,
  onChange,
  readonly = false,
  fieldContext = PLAIN_FIELD,
}: {
  record: Record<string, unknown> | undefined
  onChange: (record: Record<string, string>) => void
  readonly?: boolean
  fieldContext?: HttpRequestFieldContextValue
}) {
  const [list, setList] = useState<KeyValue[]>(() => recordToKeyValue(record))
  // The serialized record we last emitted/seeded from — detects truly external
  // changes (switching streams, a server move) vs. our own onChange echo.
  const recordStringRef = useRef(JSON.stringify(keyValueToRecord(recordToKeyValue(record))))

  useEffect(() => {
    const current = JSON.stringify(record ?? {})
    if (current !== recordStringRef.current) {
      recordStringRef.current = current
      setList(recordToKeyValue(record))
    }
  }, [record])

  const emit = (next: KeyValue[]) => {
    setList(next)
    const rec = keyValueToRecord(next)
    recordStringRef.current = JSON.stringify(rec)
    onChange(rec)
  }

  return (
    <HttpRequestFieldProvider value={fieldContext}>
      <KeyValueList
        readonly={readonly}
        list={list}
        onChange={emit}
        onAdd={() => emit([...list, { id: generateId(), key: '', value: '' }])}
        keyNotSupportVar
      />
    </HttpRequestFieldProvider>
  )
}

function recordToJsonText(record: Record<string, unknown> | undefined): string {
  if (!record || Object.keys(record).length === 0) return ''
  return JSON.stringify(record, null, 2)
}

/**
 * JSON body editor — a `Record<string, unknown>` edited as JSON text. Emits the
 * parsed object only while valid; an empty editor clears the body to `{}`. The
 * `onValidChange` callback lets the parent disable Save on a parse error.
 */
export function JsonBodyEditor({
  value,
  onChange,
  onValidChange,
}: {
  value: Record<string, unknown> | undefined
  onChange: (body: Record<string, unknown>) => void
  onValidChange?: (valid: boolean) => void
}) {
  const [text, setText] = useState(() => recordToJsonText(value))
  const [error, setError] = useState<string | null>(null)
  const emittedRef = useRef(JSON.stringify(value ?? {}))

  useEffect(() => {
    const current = JSON.stringify(value ?? {})
    if (current !== emittedRef.current) {
      emittedRef.current = current
      setText(recordToJsonText(value))
      setError(null)
      onValidChange?.(true)
    }
  }, [value, onValidChange])

  const handleChange = (next: string) => {
    setText(next)
    const trimmed = next.trim()
    if (trimmed === '') {
      setError(null)
      onValidChange?.(true)
      emittedRef.current = JSON.stringify({})
      onChange({})
      return
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setError('Body must be a JSON object')
        onValidChange?.(false)
        return
      }
      setError(null)
      onValidChange?.(true)
      emittedRef.current = JSON.stringify(parsed)
      onChange(parsed as Record<string, unknown>)
    } catch {
      setError('Invalid JSON')
      onValidChange?.(false)
    }
  }

  return (
    <div className='flex flex-col gap-1'>
      <CodeEditor
        language={CodeLanguage.json}
        value={text}
        onChange={handleChange}
        minHeight={120}
      />
      {error && <p className='px-1 text-xs text-destructive'>{error}</p>}
    </div>
  )
}

/**
 * Toggle chip that reveals a request sub-editor (headers / query params / body),
 * showing a count badge when the section has content. Shared by the stream config
 * panel and the connector endpoint panel so both reveal editors identically.
 */
export function RevealChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number | string
  active: boolean
  onClick: () => void
}) {
  const hasCount = typeof count === 'number' ? count > 0 : !!count
  return (
    <Button type='button' size='xs' variant={active ? 'secondary' : 'ghost'} onClick={onClick}>
      {active ? <Minus /> : <Plus />}
      {label}
      {hasCount && (
        <span className='ml-1 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground'>
          {count}
        </span>
      )}
    </Button>
  )
}

/**
 * A bordered, titled container for a revealed request sub-editor. The block owns
 * the outer frame, so a nested `KeyValueList` drops its own border + rounding
 * (targeted via its `data-slot`s) to sit flush under the title bar.
 */
export function RequestEditorBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className='overflow-hidden rounded-lg border bg-card/40 **:data-[slot=key-value-list]:rounded-none **:data-[slot=key-value-list]:border-0'>
      <div className='border-b px-3 py-1.5 text-xs font-medium text-muted-foreground'>{title}</div>
      {children}
    </div>
  )
}
