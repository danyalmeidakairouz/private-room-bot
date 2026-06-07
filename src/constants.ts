export const ADJECTIVES: string[] = [
  'brave',
  'swift',
  'cosmic',
  'silent',
  'golden',
  'crimson',
  'azure',
  'frosty',
  'ancient',
  'sleek',
  'radiant',
  'bold',
  'misty',
  'lunar',
  'vivid',
  'cloudy',
  'hollow',
  'bright',
  'neon',
  'lucky',
  'mighty',
  'stormy',
  'serene',
  'fierce',
];

export const NOUNS: string[] = [
  'otter',
  'falcon',
  'comet',
  'river',
  'tiger',
  'panda',
  'wolf',
  'eagle',
  'lynx',
  'raven',
  'cobra',
  'bison',
  'gecko',
  'moose',
  'heron',
  'viper',
  'finch',
  'crane',
  'trout',
  'prism',
  'spark',
  'ember',
  'drift',
  'storm',
];

export const DEFAULTS = {
  graceMs: 5000,
  inviteMaxAgeSec: 86400,
  sweepIntervalMs: 60000,
  maxRoomsPerGuild: 50,
  publicLobbyChannelName: '🔊 Join for Public',
  privateLobbyChannelName: '🔒 Join for Private',
  knockChannelName: '🚪 request-to-join',
  categoryName: 'Voice Rooms',
} as const;

// customId prefixes for the knock/approval buttons.
//   knock                                  — the static panel button (whole guild)
//   `${approve}:${channelId}:${userId}`    — a member approves the requester
//   `${deny}:${channelId}:${userId}`       — a member denies the requester
//   request (legacy)                       — old in-voice button; now redirects
// customIds are capped at 100 chars — two snowflakes fit easily.
export const BUTTON_IDS = {
  knock: 'room_knock',
  request: 'room_req',
  approve: 'room_apv',
  deny: 'room_dny',
} as const;

// customId prefixes for select menus. `pick` is the ephemeral room picker shown
// after the knock button is pressed; the chosen option value is the room channelId.
export const SELECT_IDS = {
  pick: 'room_pick',
} as const;
