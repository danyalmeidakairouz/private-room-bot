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

      // Resolve the two lobbies. `lobbyChannelId` is the legacy single-lobby field —
      // treat it as the private lobby for guilds that have not re-run /setup yet.
      const privateLobbyId = cfg.privateLobbyChannelId ?? cfg.lobbyChannelId;
      const publicLobbyId = cfg.publicLobbyChannelId;

      // JOIN-TO-CREATE: member joined one of the lobby channels — create the matching room.
      if (newState.channelId && newState.member) {
        if (newState.channelId === privateLobbyId) {
          await roomManager.createRoom(newState.member, 'private');
        }
        else if (newState.channelId === publicLobbyId) {
          await roomManager.createRoom(newState.member, 'public');
        }
      }

      // CLEANUP: member left a channel that is not one of the lobbies.
      // Safety: scheduleCleanup relies on RoomManager checking TempRoomStore before
      // deleting any channel — destroyRoom only removes channels tracked as temp rooms.
      // This handler calls scheduleCleanup unconditionally and trusts that guarantee.
      if (
        oldState.channelId &&
        oldState.channelId !== newState.channelId &&
        oldState.channelId !== privateLobbyId &&
        oldState.channelId !== publicLobbyId
      ) {
        roomManager.scheduleCleanup(oldState.channelId, guild);
      }
    }
    catch (err) {
      console.error('[voiceStateUpdate] Unhandled error:', err);
    }
  });
}
