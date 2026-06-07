import { Events, type Client } from 'discord.js';
import { RoomManager } from '../services/roomManager';
import { GuildConfigStore } from '../store/guildConfigStore';

export function registerVoiceStateUpdate(
  client: Client,
  roomManager: RoomManager,
  guildConfig: GuildConfigStore,
): void {
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
      const guild = newState.guild ?? oldState.guild;
      if (!guild) return;

      const cfg = guildConfig.get(guild.id);
      if (!cfg) return;

      // JOIN-TO-CREATE: member joined the lobby channel.
      if (newState.channelId && newState.channelId === cfg.lobbyChannelId && newState.member) {
        await roomManager.createRoom(newState.member);
      }

      // CLEANUP: member left a channel that is not the lobby.
      // Safety: scheduleCleanup relies on RoomManager checking TempRoomStore before
      // deleting any channel — destroyRoom only removes channels tracked as temp rooms.
      // This handler calls scheduleCleanup unconditionally and trusts that guarantee.
      if (
        oldState.channelId &&
        oldState.channelId !== newState.channelId &&
        oldState.channelId !== cfg.lobbyChannelId
      ) {
        roomManager.scheduleCleanup(oldState.channelId, guild);
      }
    }
    catch (err) {
      console.error('[voiceStateUpdate] Unhandled error:', err);
    }
  });
}
