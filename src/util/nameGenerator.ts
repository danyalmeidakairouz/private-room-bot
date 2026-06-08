import { ADJECTIVES, NOUNS } from '../constants';

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function generateRoomName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const rawSuffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  const suffix = rawSuffix.padEnd(3, '0').slice(0, 3);
  return `${capitalize(adjective)}-${capitalize(noun)}-${suffix}`;
}

/**
 * Pick a room name for a new channel. When the guild has configured a list of
 * candidate names for this room type, one is chosen at random and used verbatim;
 * otherwise we fall back to a generated animal name. The name is returned as-is
 * (no suffix) so it matches exactly what the admin entered.
 *
 * @param names Optional list of admin-configured candidate names.
 * @return The chosen room name.
 */
export function pickRoomName(names?: readonly string[]): string {
  if (names && names.length > 0) {
    return names[Math.floor(Math.random() * names.length)];
  }
  return generateRoomName();
}
