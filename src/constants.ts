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
  waitingRoomChannelName: '⏳ Waiting Room',
  categoryName: 'Voice Rooms',
  // How long a knocker is held (muted + deafened) in the private room while the
  // knock sound plays, before being moved to the waiting room.
  knockHoldMs: 1200,
} as const;

// customId prefixes for the approval buttons posted in a private room's chat.
//   `${approve}:${channelId}:${userId}`  — a member approves the knocker
//   `${deny}:${channelId}:${userId}`     — a member denies the knocker
// customIds are capped at 100 chars — two snowflakes fit easily.
export const BUTTON_IDS = {
  approve: 'room_apv',
  deny: 'room_dny',
} as const;
