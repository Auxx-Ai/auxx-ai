// apps/homepage/src/lib/blog-image.ts

import type { BlogPost } from '~/types/blog'

/**
 * Placeholder assigned to posts whose frontmatter omits `image`. No such file
 * exists in `public/blog` — it is a sentinel meaning "this post has no artwork",
 * which the card and header treatments check before rendering an `<Image>`.
 */
export const DEFAULT_OG_IMAGE = '/blog/default-og.jpg'

/**
 * The post's artwork, or `null` when it has none. Kept free of `node:fs` imports
 * so components can use it without pulling in the content loader.
 */
export function getPostImage(post: Pick<BlogPost, 'image'>): string | null {
  if (!post.image || post.image === DEFAULT_OG_IMAGE) return null
  return post.image
}
