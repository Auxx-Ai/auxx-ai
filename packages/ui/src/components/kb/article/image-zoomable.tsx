// packages/ui/src/components/kb/article/image-zoomable.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import styles from './kb-article-renderer.module.css'

interface ImageZoomableProps {
  src: string
  width?: number
  alt?: string
}

export function ImageZoomable({ src, width, alt = '' }: ImageZoomableProps) {
  const [open, setOpen] = useState(false)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  return (
    <>
      <button
        type='button'
        className={styles.imageZoomTrigger}
        onClick={() => setOpen(true)}
        aria-label='Open image in fullscreen'>
        {/** biome-ignore lint/performance/noImgElement: Next/Image not used cross-package; consumers can override */}
        <img src={src} width={width} alt={alt} />
      </button>
      {open && (
        <div
          className={styles.imageZoomOverlay}
          role='dialog'
          aria-modal='true'
          aria-label='Image preview'
          onClick={close}>
          {/** biome-ignore lint/performance/noImgElement: Next/Image not used cross-package; consumers can override */}
          <img src={src} alt={alt} className={styles.imageZoomFull} />
        </div>
      )}
    </>
  )
}
