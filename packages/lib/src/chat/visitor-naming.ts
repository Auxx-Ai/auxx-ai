// packages/lib/src/chat/visitor-naming.ts

/**
 * Generate a deterministic friendly handle for an anonymous chat visitor.
 *
 * Two integers derived from the seed (typically the sticky session id) index
 * into curated color + animal lists. A non-empty `city` is appended as
 * `"from <city>"` — Intercom parity (e.g. `"Cyan Turtle from Inglewood"`).
 *
 * Pure function; no I/O. Same seed → same output regardless of host.
 */

const COLORS = [
  'Amber',
  'Azure',
  'Bronze',
  'Cerulean',
  'Cobalt',
  'Copper',
  'Coral',
  'Crimson',
  'Cyan',
  'Emerald',
  'Fuchsia',
  'Garnet',
  'Golden',
  'Indigo',
  'Ivory',
  'Jade',
  'Lavender',
  'Lemon',
  'Magenta',
  'Maroon',
  'Mauve',
  'Mint',
  'Navy',
  'Obsidian',
  'Olive',
  'Onyx',
  'Opal',
  'Peach',
  'Periwinkle',
  'Plum',
  'Rose',
  'Ruby',
  'Saffron',
  'Sage',
  'Sapphire',
  'Scarlet',
  'Silver',
  'Slate',
  'Teal',
  'Topaz',
  'Turquoise',
  'Violet',
] as const

const ANIMALS = [
  'Albatross',
  'Antelope',
  'Badger',
  'Beaver',
  'Bison',
  'Buffalo',
  'Camel',
  'Caribou',
  'Cheetah',
  'Cobra',
  'Coyote',
  'Crane',
  'Dolphin',
  'Eagle',
  'Elephant',
  'Elk',
  'Falcon',
  'Ferret',
  'Finch',
  'Flamingo',
  'Fox',
  'Gazelle',
  'Gecko',
  'Giraffe',
  'Goose',
  'Hare',
  'Hawk',
  'Hedgehog',
  'Heron',
  'Hummingbird',
  'Ibex',
  'Iguana',
  'Impala',
  'Jaguar',
  'Kangaroo',
  'Kingfisher',
  'Koala',
  'Kudu',
  'Leopard',
  'Lemur',
  'Llama',
  'Lynx',
  'Macaw',
  'Manatee',
  'Marmot',
  'Meerkat',
  'Mongoose',
  'Moose',
  'Narwhal',
  'Ocelot',
  'Octopus',
  'Orca',
  'Otter',
  'Owl',
  'Panda',
  'Pangolin',
  'Panther',
  'Parrot',
  'Pelican',
  'Penguin',
  'Platypus',
  'Puffin',
  'Quokka',
  'Rabbit',
  'Raccoon',
  'Raven',
  'Reindeer',
  'Salamander',
  'Seahorse',
  'Seal',
  'Sloth',
  'Sparrow',
  'Stingray',
  'Stork',
  'Swallow',
  'Swan',
  'Tapir',
  'Tiger',
  'Toucan',
  'Turtle',
  'Walrus',
  'Wolf',
  'Wolverine',
  'Wombat',
  'Yak',
  'Zebra',
] as const

/** FNV-1a 32-bit hash. Pure JS, no deps. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Deterministic friendly handle for an anonymous chat visitor.
 *
 * @example generateVisitorName('7c0e8605-…-d1a566d4354b', 'Inglewood')
 *          → 'Cyan Turtle from Inglewood'
 * @example generateVisitorName('7c0e8605-…-d1a566d4354b')
 *          → 'Cyan Turtle'
 */
export function generateVisitorName(seed: string, city?: string): string {
  const colorHash = fnv1a(`color:${seed}`)
  const animalHash = fnv1a(`animal:${seed}`)
  const color = COLORS[colorHash % COLORS.length]
  const animal = ANIMALS[animalHash % ANIMALS.length]
  const base = `${color} ${animal}`
  const trimmedCity = city?.trim()
  return trimmedCity ? `${base} from ${trimmedCity}` : base
}
