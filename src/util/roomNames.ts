// Shared parsing for the admin-configured room-name lists used by
// /public-channels-names, /private-channels-names, and the /setup summary.

// Hard caps so a pasted blob can't produce an over-long channel name or an
// unbounded candidate list.
export const MAX_ROOM_NAME_LEN = 100; // Discord's channel-name character limit.
export const MAX_ROOM_NAME_LIST = 50;

/**
 * Parse an admin-entered list of room names into a clean array. Entries may be
 * separated by commas, semicolons, or newlines; each is trimmed and capped at
 * the channel-name limit, blanks are dropped, and the list length is capped.
 *
 * @param raw The raw text the admin entered.
 * @return The cleaned list of names (possibly empty).
 */
export function parseRoomNames(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((n) => n.trim().slice(0, MAX_ROOM_NAME_LEN))
    .filter((n) => n.length > 0)
    .slice(0, MAX_ROOM_NAME_LIST);
}

/**
 * Make a room name unique against a set of already-used names by appending
 * ` - 2`, ` - 3`, … to the first free slot. The base name is used as-is when it
 * doesn't collide. The result is always kept within the channel-name length
 * limit (the base is trimmed to make room for the suffix when needed).
 *
 * @param base The desired room name.
 * @param taken The names already in use (e.g. existing channels in the category).
 * @return A name not present in `taken`.
 */
export function resolveUniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) {
    return base;
  }
  for (let n = 2; ; n++) {
    const suffix = ` - ${n}`;
    const candidate = base.slice(0, MAX_ROOM_NAME_LEN - suffix.length) + suffix;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}
