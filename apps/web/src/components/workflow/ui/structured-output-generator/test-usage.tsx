// apps/web/src/components/workflow/ui/structured-output-generator/test-usage.tsx
// This is a test file to demonstrate usage - delete after testing

import { useState } from 'react'
import StructuredOutputGenerator from './index'
import type { SchemaRoot } from './types'

export function TestStructuredOutputGenerator() {
  const [isOpen, setIsOpen] = useState(false)

  const handleSave = (schema: SchemaRoot) => {
    console.log('Saved schema:', schema)
  }

  return (
    <>
      <button onClick={() => setIsOpen(true)}>Open Structured Output Generator</button>

      <StructuredOutputGenerator
        isShow={isOpen}
        onSave={handleSave}
        onClose={() => setIsOpen(false)}
      />
    </>
  )
}
