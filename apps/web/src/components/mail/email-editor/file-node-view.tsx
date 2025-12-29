import { NodeViewWrapper } from '@tiptap/react'
import { useState } from 'react'

const FileNodeView = ({ node, updateAttributes }: any) => {
  const { src, filename } = node.attrs
  const [isLoading, setIsLoading] = useState(false)

  const handleUpload = async () => {
    setIsLoading(true)
    // Mock async upload
    setTimeout(() => {
      updateAttributes({ src: `https://yourcdn.com/${filename}` })
      setIsLoading(false)
    }, 1500)
  }

  return (
    <NodeViewWrapper as="div" className="file-node rounded-md border p-2">
      {src ? (
        <div className="flex items-center gap-2">
          <img src={src} alt={filename} className="h-5 w-5 object-cover" />
          <span>{filename}</span>
        </div>
      ) : (
        <button
          className="rounded-md bg-blue-500 px-3 py-1 text-white"
          onClick={handleUpload}
          disabled={isLoading}>
          {isLoading ? 'Uploading...' : 'Upload'}
        </button>
      )}
    </NodeViewWrapper>
  )
}

export default FileNodeView
