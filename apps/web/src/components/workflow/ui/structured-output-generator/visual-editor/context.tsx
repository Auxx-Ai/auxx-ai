// apps/web/src/components/workflow/ui/structured-output-generator/visual-editor/context.tsx
import type React from 'react'
import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { createVisualEditorStore } from './store'

type VisualEditorStore = ReturnType<typeof createVisualEditorStore>

type VisualEditorContextType = VisualEditorStore | null

type VisualEditorProviderProps = {
  children: React.ReactNode
}

export const VisualEditorContext = createContext<VisualEditorContextType>(null)

export const VisualEditorContextProvider = ({ children }: VisualEditorProviderProps) => {
  const storeRef = useRef<VisualEditorStore>()

  if (!storeRef.current) storeRef.current = createVisualEditorStore()

  return (
    <VisualEditorContext.Provider value={storeRef.current}>{children}</VisualEditorContext.Provider>
  )
}

// Event emitter context to replace useMitt
type EventHandlers = {
  [key: string]: ((data: any) => void)[]
}

interface EventEmitterContextType {
  emit: (event: string, data?: any) => void
  useSubscribe: (event: string, handler: (data: any) => void) => void
}

const EventEmitterContext = createContext<EventEmitterContextType>({
  emit: () => {},
  useSubscribe: () => {},
})

export const EventEmitterProvider = ({ children }: { children: React.ReactNode }) => {
  const handlersRef = useRef<EventHandlers>({})

  const emit = useCallback((event: string, data?: any) => {
    const handlers = handlersRef.current[event]
    if (handlers) {
      handlers.forEach((handler) => handler(data))
    }
  }, [])

  const useSubscribe = (event: string, handler: (data: any) => void) => {
    useEffect(() => {
      if (!handlersRef.current[event]) {
        handlersRef.current[event] = []
      }
      handlersRef.current[event].push(handler)

      return () => {
        if (handlersRef.current[event]) {
          handlersRef.current[event] = handlersRef.current[event].filter((h) => h !== handler)
        }
      }
    }, [event, handler])
  }

  return (
    <EventEmitterContext.Provider value={{ emit, useSubscribe }}>
      {children}
    </EventEmitterContext.Provider>
  )
}

export const useEventEmitter = () => {
  return useContext(EventEmitterContext)
}
