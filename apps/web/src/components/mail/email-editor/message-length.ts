// apps/web/src/components/mail/email-editor/message-length.ts

/**
 * GSM 03.38 basic character set — the alphabet an SMS can encode at 7 bits per
 * character. Anything outside it (an emoji, a curly quote, "…") forces the
 * whole message to UCS-2 and cuts the segment size from 160 to 70.
 */
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'

/**
 * GSM extension table. These encode as two septets, which we deliberately do
 * NOT model — the counter is an estimate for the user, not a billing oracle.
 */
const GSM_EXTENDED = '^{}\\[~]|€'

const GSM_CHARS = new Set([...GSM_BASIC, ...GSM_EXTENDED])

export interface SmsLengthInfo {
  /** UTF-16 code units — the unit UCS-2 segmentation actually counts. */
  characters: number
  /** Number of billed SMS segments. 0 for an empty body. */
  segments: number
  /** True when the body forces UCS-2 encoding (70-char segments). */
  unicode: boolean
}

/**
 * Characters and billed segments for an SMS body.
 *
 * Segments, not raw characters, are what a carrier bills, and a single emoji
 * more than halves the segment size — which is why this is worth showing at
 * all. Concatenated messages spend 7 septets on a UDH header, hence 153/67
 * rather than 160/70 once a body spills past one segment.
 */
export function smsLength(text: string): SmsLengthInfo {
  const characters = text.length
  const unicode = ![...text].every((char) => GSM_CHARS.has(char))
  if (characters === 0) return { characters, segments: 0, unicode }
  const single = unicode ? 70 : 160
  if (characters <= single) return { characters, segments: 1, unicode }
  const multi = unicode ? 67 : 153
  return { characters, segments: Math.ceil(characters / multi), unicode }
}
