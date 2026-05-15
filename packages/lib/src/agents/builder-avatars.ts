// packages/lib/src/agents/builder-avatars.ts

/**
 * Curated avatar pool the builder picks from when an admin asks the AI to set
 * an avatar via the chat. Each entry maps a stable slug → a curated
 * illustration. `assetId` is `null` for the v1 emoji-only set (the avatar
 * renderer falls back to the agent name's initials on null asset). Future
 * iterations swap in real MediaAsset rows without changing the slug API.
 */
export interface BuilderAvatar {
  slug: string
  /** Emoji or short label shown in the chat acknowledgement. */
  emoji: string
  /** Human-readable label for the chat prompt catalog. */
  label: string
  /**
   * Optional URL the chat can echo back ("I gave it 🦊"). Today this is just
   * the emoji rendered as text; once curated illustrations land, this becomes
   * an `https://` URL to the rendered asset.
   */
  url: string
  /**
   * MediaAsset id written to `User.avatarAssetId`. `null` for the v1
   * emoji-only pool — the avatar renderer keeps the existing initials/emoji
   * fallback. Real assets ship in a follow-up PR.
   */
  assetId: string | null
}

export const BUILDER_AVATAR_POOL: BuilderAvatar[] = [
  { slug: 'fox', emoji: '🦊', label: 'Fox', url: '🦊', assetId: null },
  { slug: 'owl', emoji: '🦉', label: 'Owl', url: '🦉', assetId: null },
  { slug: 'robot', emoji: '🤖', label: 'Robot', url: '🤖', assetId: null },
  { slug: 'sparkle', emoji: '✨', label: 'Sparkle', url: '✨', assetId: null },
  { slug: 'rocket', emoji: '🚀', label: 'Rocket', url: '🚀', assetId: null },
  { slug: 'cat', emoji: '🐱', label: 'Cat', url: '🐱', assetId: null },
  { slug: 'dog', emoji: '🐶', label: 'Dog', url: '🐶', assetId: null },
  { slug: 'octopus', emoji: '🐙', label: 'Octopus', url: '🐙', assetId: null },
  { slug: 'turtle', emoji: '🐢', label: 'Turtle', url: '🐢', assetId: null },
  { slug: 'whale', emoji: '🐳', label: 'Whale', url: '🐳', assetId: null },
  { slug: 'leaf', emoji: '🌿', label: 'Leaf', url: '🌿', assetId: null },
  { slug: 'flame', emoji: '🔥', label: 'Flame', url: '🔥', assetId: null },
]

const BUILDER_AVATAR_BY_SLUG: Record<string, BuilderAvatar> = Object.fromEntries(
  BUILDER_AVATAR_POOL.map((a) => [a.slug, a])
)

export function resolveBuilderAvatar(slug: string): BuilderAvatar | null {
  return BUILDER_AVATAR_BY_SLUG[slug] ?? null
}
