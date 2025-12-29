import Image from 'next/image'
// import { clientFileStorage } from '@auxx/lib/files/client'
import { cn } from '@auxx/ui/lib/utils'

type ImageProps = React.ComponentProps<typeof Image>

interface ImagePreviewProps extends Omit<ImageProps, 'src'> {
  storageKey: string
  fallback?: React.ReactNode
  onError?: () => void
}

export function ImagePreview({
  storageKey,
  alt = 'Image',
  className,
  fallback,
  onError,
  ...props
}: ImagePreviewProps) {
  if (!storageKey) {
    return fallback || null
  }
  const imageUrl = `/api/file/${storageKey}` // Assuming you have an API route to serve the image
  // const imageUrl = clientFileStorage.getPublicUrl(storageKey)

  return (
    <Image src={imageUrl} alt={alt} fill className={cn(className)} onError={onError} {...props} />
  )
}
