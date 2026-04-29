// apps/kb/src/app/[orgSlug]/[kbSlug]/not-found.tsx

export default function NotFound() {
  return (
    <div style={{ padding: '4rem 1.5rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Article not found</h1>
      <p style={{ opacity: 0.7 }}>This page may have been moved or unpublished.</p>
    </div>
  )
}
