// apps/web/src/components/data-connectors/ui/request-editors.tsx
'use client'

import { generateId } from '@auxx/utils/generateId'
import { useEffect, useRef, useState } from 'react'
import {
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

const PLAIN_FIELD = { FieldEditor: PlainFieldEditor }

/** Headers / query params — a Record-backed wrapper over the shared KeyValueList. */
export function RecordKeyValueEditor({
  record,
  onChange,
  readonly = false,
}: {
  record: Record<string, unknown> | undefined
  onChange: (record: Record<string, string>) => void
  readonly?: boolean
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
    <HttpRequestFieldProvider value={PLAIN_FIELD}>
      <KeyValueList
        readonly={readonly}
        list={list}
        onChange={emit}
        onAdd={() => emit([...list, { id: generateId(), key: '', value: '' }])}
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
