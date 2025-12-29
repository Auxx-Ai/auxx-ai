// apps/web/src/components/files/utils/file-type.ts

/**
 * Get standardized file type category for display
 * @param mimeType File MIME type
 * @param ext File extension
 * @returns Standardized file type string
 */
export function getStandardFileType(mimeType?: string, ext?: string): string {
  // Check MIME type first
  if (mimeType) {
    if (mimeType.startsWith('image/')) {
      return 'Image'
    }
    if (mimeType.startsWith('video/')) {
      return 'Video'
    }
    if (mimeType.startsWith('audio/')) {
      return 'Audio'
    }
    if (mimeType.startsWith('text/')) {
      return 'Text'
    }
    if (mimeType === 'application/pdf') {
      return 'PDF'
    }
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
      return 'Spreadsheet'
    }
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
      return 'Presentation'
    }
    if (mimeType.includes('document') || mimeType.includes('word')) {
      return 'Document'
    }
    if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('compressed')) {
      return 'Archive'
    }
    if (mimeType === 'application/json') {
      return 'JSON'
    }
    if (mimeType === 'application/xml' || mimeType === 'text/xml') {
      return 'XML'
    }
  }
  
  // Fallback to extension
  if (ext) {
    const extension = ext.toLowerCase()
    
    // Images
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff'].includes(extension)) {
      return 'Image'
    }
    
    // Videos
    if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', '3gp', 'm4v'].includes(extension)) {
      return 'Video'
    }
    
    // Audio
    if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus'].includes(extension)) {
      return 'Audio'
    }
    
    // Documents
    if (['txt', 'md', 'rtf'].includes(extension)) {
      return 'Text'
    }
    if (['doc', 'docx', 'odt'].includes(extension)) {
      return 'Document'
    }
    
    // PDFs
    if (extension === 'pdf') {
      return 'PDF'
    }
    
    // Spreadsheets
    if (['xls', 'xlsx', 'ods'].includes(extension)) {
      return 'Spreadsheet'
    }
    if (extension === 'csv') {
      return 'CSV'
    }
    
    // Presentations
    if (['ppt', 'pptx', 'odp'].includes(extension)) {
      return 'Presentation'
    }
    
    // Code files
    if (['js', 'jsx'].includes(extension)) {
      return 'JavaScript'
    }
    if (['ts', 'tsx'].includes(extension)) {
      return 'TypeScript'
    }
    if (['html', 'htm'].includes(extension)) {
      return 'HTML'
    }
    if (['css', 'scss', 'sass', 'less'].includes(extension)) {
      return 'Stylesheet'
    }
    if (extension === 'json') {
      return 'JSON'
    }
    if (['xml', 'xsl'].includes(extension)) {
      return 'XML'
    }
    if (extension === 'py') {
      return 'Python'
    }
    if (['java', 'class', 'jar'].includes(extension)) {
      return 'Java'
    }
    if (['cpp', 'cxx', 'cc'].includes(extension)) {
      return 'C++'
    }
    if (extension === 'c') {
      return 'C'
    }
    if (extension === 'php') {
      return 'PHP'
    }
    if (extension === 'rb') {
      return 'Ruby'
    }
    if (extension === 'go') {
      return 'Go'
    }
    if (extension === 'rs') {
      return 'Rust'
    }
    if (extension === 'swift') {
      return 'Swift'
    }
    if (['kt', 'kts'].includes(extension)) {
      return 'Kotlin'
    }
    if (['sh', 'bash', 'zsh', 'fish'].includes(extension)) {
      return 'Shell Script'
    }
    
    // Archives
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'lz', 'lzma'].includes(extension)) {
      return 'Archive'
    }
    
    // Fonts
    if (['ttf', 'otf', 'woff', 'woff2', 'eot'].includes(extension)) {
      return 'Font'
    }
    
    // Executables
    if (['exe', 'msi', 'deb', 'rpm', 'dmg', 'pkg', 'app'].includes(extension)) {
      return 'Executable'
    }
    
    // Data files
    if (['sql', 'db', 'sqlite', 'sqlite3'].includes(extension)) {
      return 'Database'
    }
  }
  
  // Return the extension as-is if we can't categorize it
  return ext ? ext.toUpperCase() : 'File'
}

/**
 * Get file category for filtering purposes
 * @param mimeType File MIME type
 * @param ext File extension
 * @returns File category string
 */
export function getFileCategory(mimeType?: string, ext?: string): string {
  if (mimeType) {
    if (mimeType.startsWith('image/')) return 'images'
    if (mimeType.startsWith('video/')) return 'videos'
    if (mimeType.startsWith('audio/')) return 'audio'
    if (mimeType.startsWith('text/') || 
        mimeType.includes('document') || 
        mimeType.includes('word') ||
        mimeType === 'application/pdf') return 'documents'
    if (mimeType.includes('zip') || 
        mimeType.includes('archive') || 
        mimeType.includes('compressed')) return 'archives'
  }
  
  if (ext) {
    const extension = ext.toLowerCase()
    
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff'].includes(extension)) {
      return 'images'
    }
    if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', '3gp', 'm4v'].includes(extension)) {
      return 'videos'
    }
    if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus'].includes(extension)) {
      return 'audio'
    }
    if (['txt', 'md', 'rtf', 'doc', 'docx', 'odt', 'pdf', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'].includes(extension)) {
      return 'documents'
    }
    if (['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'scss', 'json', 'xml', 'py', 'java', 'cpp', 'c', 'php', 'rb', 'go', 'rs', 'swift', 'kotlin'].includes(extension)) {
      return 'code'
    }
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(extension)) {
      return 'archives'
    }
  }
  
  return 'other'
}