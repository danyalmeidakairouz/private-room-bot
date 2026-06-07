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
  categoryName: 'Voice Rooms',
} as const;

// customId prefixes for the private-room knock/approval buttons.
// Format: `${prefix}:${channelId}` for requests, `${prefix}:${channelId}:${userId}`
// for approve/deny. customIds are capped at 100 chars — two snowflakes fit easily.
export const BUTTON_IDS = {
  request: 'room_req',
  approve: 'room_apv',
  deny: 'room_dny',
} as const;
