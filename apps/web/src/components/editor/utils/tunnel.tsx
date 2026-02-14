import { atom, useAtomValue, useSetAtom } from 'jotai' // Import Jotai hooks
import React, { type ReactNode } from 'react'

/**
 * An SSR-friendly useLayoutEffect.
 *
 * React currently throws a warning when using useLayoutEffect on the server.
 * To get around it, we can conditionally useEffect on the server (no-op) and
 * useLayoutEffect elsewhere.
 *
 * @see https://github.com/facebook/react/issues/14927
 */
export const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' &&
  (window.document?.createElement || window.navigator?.product === 'ReactNative')
    ? React.useLayoutEffect
    : React.useEffect

export function useMutableCallback<T>(fn: T) {
  const ref = React.useRef<T>(fn)
  useIsomorphicLayoutEffect(() => void (ref.current = fn), [fn])
  return ref
}

type Props = { children: React.ReactNode }

// No global State type needed like in Zustand for the store itself

export default function tunnel() {
  // Define atoms within the tunnel function scope
  // Each call to tunnel() gets its own independent atoms
  const currentAtom = atom<ReactNode[]>([])
  const versionAtom = atom(0)

  return {
    In: ({ children }: Props) => {
      // Get setter functions for the atoms
      const setCurrent = useSetAtom(currentAtom)
      const setVersion = useSetAtom(versionAtom)
      // Get the version value to use as a dependency
      const version = useAtomValue(versionAtom)

      /* When this component mounts, we increase the version atom's value.
      This will cause all existing Out components listening to currentAtom
      (implicitly via version dependency in In components) to re-render
      or trigger effects in In components depending on version. */
      useIsomorphicLayoutEffect(() => {
        // Update using the setter function with an updater
        setVersion((v) => v + 1)
        // No explicit dependency array needed for setVersion itself,
        // but the effect runs once on mount.
      }, [setVersion]) // Include stable setters in deps array as per lint rules

      /* Any time the children _or_ the version atom's value change, insert
      the specified React children into the list. */
      useIsomorphicLayoutEffect(() => {
        // Add children using the setter function with an updater
        setCurrent((current) => [...current, children])

        // Return cleanup function
        return () =>
          // Remove children using the setter function with an updater
          setCurrent((current) => current.filter((c) => c !== children))

        // Depend on children, version value, and the stable setter function
      }, [children, version, setCurrent])

      return null // In component doesn't render anything itself
    },

    Out: () => {
      // Read the value of the currentAtom
      const current = useAtomValue(currentAtom)
      // Render the array of nodes
      return <>{current}</>
    },
  }
}
