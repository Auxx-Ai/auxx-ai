// apps/web/src/components/kopilot/hooks/use-smooth-stream.ts

'use client'

import { useEffect, useRef, useState } from 'react'

export interface SmoothStreamResult {
  /** Substring of raw that should currently be displayed. */
  displayed: string
  /** Absolute word count of the displayed prefix (for stable keys). */
  displayedWordCount: number
}

interface SmoothStreamOpts {
  isStreaming?: boolean
  /** Baseline characters-per-second drip rate. Default 100. */
  cps?: number
}

const BACKLOG_K = 4
const CPS_CAP = 600

/**
 * Drips `raw` out at an adaptive characters-per-second rate, smoothing model
 * bursts into a continuous reveal. Returns the substring currently revealed
 * plus its word count for stable per-word keys.
 */
export function useSmoothStream(raw: string, opts?: SmoothStreamOpts): SmoothStreamResult {
  const isStreaming = opts?.isStreaming ?? true
  const baseline = opts?.cps ?? 100

  const cursorRef = useRef(0)
  const lastTickRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const rawRef = useRef(raw)
  const isStreamingRef = useRef(isStreaming)
  const baselineRef = useRef(baseline)

  const [displayed, setDisplayed] = useState('')
  const [displayedWordCount, setDisplayedWordCount] = useState(0)

  rawRef.current = raw
  isStreamingRef.current = isStreaming
  baselineRef.current = baseline

  // Reset on new message (raw shrunk or cleared).
  useEffect(() => {
    if (raw.length < cursorRef.current) {
      cursorRef.current = 0
      lastTickRef.current = null
      setDisplayed('')
      setDisplayedWordCount(0)
    }
  }, [raw])

  // Poke the rAF loop awake whenever there's new backlog.
  useEffect(() => {
    if (rafRef.current !== null) return
    if (cursorRef.current >= raw.length) return

    const tick = (now: number) => {
      const last = lastTickRef.current ?? now
      const dt = Math.max(0, (now - last) / 1000)
      lastTickRef.current = now

      const total = rawRef.current.length
      const backlog = total - cursorRef.current

      if (backlog <= 0) {
        rafRef.current = null
        lastTickRef.current = null
        return
      }

      // When the upstream is done but we still have backlog, drain at cap.
      const cps = isStreamingRef.current
        ? Math.min(CPS_CAP, baselineRef.current + BACKLOG_K * backlog)
        : CPS_CAP
      const advance = Math.max(1, Math.floor(cps * dt))
      const next = Math.min(total, cursorRef.current + advance)
      cursorRef.current = next

      const slice = rawRef.current.slice(0, next)
      setDisplayed(slice)
      setDisplayedWordCount(countWords(slice))

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [raw])

  // Cancel on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [])

  return { displayed, displayedWordCount }
}

function countWords(s: string): number {
  if (!s) return 0
  const m = s.match(/\S+/g)
  return m ? m.length : 0
}

export interface StreamSplit {
  prefix: string
  tail: string
  /** Absolute word count of prefix. Used for stable tail keys. */
  prefixWordCount: number
}

interface SplitOpts {
  tailWords?: number
}

/**
 * Split the currently-displayed string into a stable markdown prefix and a
 * trailing window of up to `tailWords` words for per-word animation. Holds the
 * tail empty while inside an unclosed ```auxx:` fence so partial JSON stays in
 * the prefix where the code-block renderer can show a partial card.
 */
export function splitAtHorizon(displayed: string, opts?: SplitOpts): StreamSplit {
  const tailWords = opts?.tailWords ?? 12

  if (hasOpenAuxxFence(displayed)) {
    return { prefix: displayed, tail: '', prefixWordCount: countWords(displayed) }
  }

  const wordPositions: number[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(displayed)) !== null) {
    wordPositions.push(m.index)
  }

  const total = wordPositions.length
  if (total <= tailWords) {
    return { prefix: '', tail: displayed, prefixWordCount: 0 }
  }

  const splitIdx = total - tailWords
  const splitAt = wordPositions[splitIdx]!
  return {
    prefix: displayed.slice(0, splitAt),
    tail: displayed.slice(splitAt),
    prefixWordCount: splitIdx,
  }
}

/**
 * Detect whether the displayed string contains an opened (but not yet closed)
 * ```auxx:<type> fenced block.
 */
function hasOpenAuxxFence(s: string): boolean {
  const fenceRe = /```/g
  let openedAuxx = false
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(s)) !== null) {
    if (!openedAuxx) {
      const after = s.slice(m.index + 3)
      const nl = after.indexOf('\n')
      const info = (nl === -1 ? after : after.slice(0, nl)).trim()
      if (info.startsWith('auxx:')) openedAuxx = true
    } else {
      openedAuxx = false
    }
  }
  return openedAuxx
}
