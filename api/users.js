import { randomInt } from 'crypto'

// Temporary password after a reset, easy to read out or type: e.g. "k7mp-2xqf-9hwd-4tnc".
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const temporaryPassword = () =>
  Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')).join('-')
