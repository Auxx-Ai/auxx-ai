// import { createImageUpload } from 'novel'
// DEPRECATED: not used anywhere. remove soon.
import { toast } from 'sonner'
import { createImageUpload } from './upload-images-plugin'

const onUpload = (file: File) => {
  // Create FormData to match the existing attachments/upload endpoint
  const formData = new FormData()
  formData.append('file', file)
  // Note: This will need articleId or ticketId depending on context
  // For now, we'll need to pass this context from the editor component

  const promise = fetch('/', {
    method: 'POST',
    body: formData,
  })

  return new Promise((resolve, reject) => {
    toast.promise(
      promise.then(async (res) => {
        // Successfully uploaded image
        if (res.status === 200) {
          const { url } = (await res.json()) as { url: string }
          // preload the image
          const image = new Image()
          image.src = url
          image.onload = () => {
            resolve(url)
          }
          // No blob store configured
        } else if (res.status === 401) {
          resolve(file)
          throw new Error(
            '`BLOB_READ_WRITE_TOKEN` environment variable not found, reading image locally instead.'
          )
          // Unknown error
        } else {
          throw new Error('Error uploading image. Please try again.')
        }
      }),
      {
        loading: 'Uploading image...',
        success: 'Image uploaded successfully.',
        error: (e) => {
          reject(e)
          return e.message
        },
      }
    )
  })
}

export const uploadFn = createImageUpload({
  onUpload,
  validateFn: (file) => {
    if (!file.type.includes('image/')) {
      toast.error('File type not supported.')
      return false
    }
    if (file.size / 1024 / 1024 > 20) {
      toast.error('File size too big (max 20MB).')
      return false
    }
    return true
  },
})
