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
  // 0 = delete a room the instant its last member leaves (no grace window).
  graceMs: 0,
  inviteMaxAgeSec: 86400,
  sweepIntervalMs: 60000,
  maxRoomsPerGuild: 50,
  publicLobbyChannelName: '🔊 Join for Public',
  privateLobbyChannelName: '🔒 Join for Private',
  knockChannelName: '🚪 request-to-join',
  categoryName: 'Voice Rooms',
} as const;

// customId prefixes for the request/approval buttons.
//   `${request}:${channelId}`            — an outsider knocks from the request-to-join panel
//   `${allow}:${channelId}:${userId}`    — a member in the room lets the requester in
// customIds are capped at 100 chars — a prefix plus two snowflakes fits easily.
export const BUTTON_IDS = {
  request: 'room_req',
  allow: 'room_alw',
} as const;
