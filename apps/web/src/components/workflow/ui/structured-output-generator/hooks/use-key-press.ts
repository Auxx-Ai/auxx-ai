// apps/web/src/components/workflow/ui/structured-output-generator/hooks/use-key-press.ts
import { useEffect } from 'react'

export function useKeyPress(
  keys: string[],
  handler: (e: KeyboardEvent) => void,
  options?: { exactMatch?: boolean; useCapture?: boolean }
) {
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const pressedKeys = []

      if (e.ctrlKey || e.metaKey) pressedKeys.push('ctrl')
      if (e.shiftKey) pressedKeys.push('shift')
      if (e.altKey) pressedKeys.push('alt')

      // Add the actual key
      if (e.key === 'Enter') {
        pressedKeys.push('enter')
      } else if (e.key) {
        pressedKeys.push(e.key.toLowerCase())
      }

      const keyCombo = pressedKeys.join('.')

      // Check if any of the target keys match
      const isMatch = keys.some((key) => {
        const normalizedKey = key.toLowerCase().replace('cmd', 'ctrl').replace('command', 'ctrl')
        return normalizedKey === keyCombo
      })

      if (isMatch) {
        handler(e)
      }
    }

    document.addEventListener('keydown', handleKeyPress, options?.useCapture)
    return () => document.removeEventListener('keydown', handleKeyPress, options?.useCapture)
  }, [keys, handler, options])
}
