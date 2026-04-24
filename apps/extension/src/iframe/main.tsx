// apps/extension/src/iframe/main.tsx

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import './styles.css'

// Inherit the browser's colour-scheme preference for v1. A persisted toggle
// lives in a follow-up plan; @auxx/ui's global stylesheet flips on the
// `.dark` class via @custom-variant.
if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.classList.add('dark')
}

const root = document.getElementById('root')
if (!root) throw new Error('iframe root element missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
