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
