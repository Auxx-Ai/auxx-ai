import { complete, errored, type UploadError } from '../errors.js'

/**
 * Uploads a JavaScript bundle to a given URL
 * @param bundle - The bundle content as a string
 * @param uploadUrl - The URL to upload the bundle to
 * @returns AsyncResult indicating success or failure
 */
export async function uploadBundle(bundle: string, uploadUrl: string) {
  try {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body: bundle,
      headers: {
        'Content-Type': 'text/javascript',
        'Content-Length': String(Buffer.from(bundle).length),
      },
    })

    if (!response.ok) {
      return errored<UploadError>({
        code: 'BUNDLE_UPLOAD_ERROR',
        uploadUrl: uploadUrl,
        status: response.status,
        statusText: response.statusText,
      })
    }

    return complete(undefined)
  } catch (error) {
    return errored<UploadError>({
      code: 'BUNDLE_UPLOAD_ERROR',
      uploadUrl: uploadUrl,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
