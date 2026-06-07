import { Client, GatewayIntentBits } from 'discord.js';
import { loadConfig } from './config';
import { GuildConfigStore } from './store/guildConfigStore';
import { TempRoomStore } from './store/tempRoomStore';
import { KnockMuteStore } from './store/knockMuteStore';
import { RoomManager } from './services/roomManager';
import { registerReady } from './events/ready';
import { registerVoiceStateUpdate } from './events/voiceStateUpdate';
import { registerInteractionCreate } from './events/interactionCreate';

const config = loadConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    // GuildMembers is a privileged intent — must be enabled in the Discord Developer Portal
    // under Bot → Privileged Gateway Intents → Server Members Intent.
    GatewayIntentBits.GuildMembers,
  ],
});

const guildConfig = new GuildConfigStore(config.dataDir);
const tempRooms = new TempRoomStore(config.dataDir);
const knockMutes = new KnockMuteStore(config.dataDir);
const roomManager = new RoomManager(client, guildConfig, tempRooms, knockMutes);

registerReady(client, roomManager);
registerVoiceStateUpdate(client, roomManager, guildConfig);
registerInteractionCreate(client, guildConfig, roomManager);

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

client.login(config.token);
