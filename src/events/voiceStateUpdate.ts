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

      // Only react to an actual channel join/move — NOT mute/deafen self-updates
      // (those keep the same channelId, and the bot itself toggles mute during a
      // knock; reacting to them would instantly undo the knock mute).
      const joinedChannelId =
        newState.channelId && newState.channelId !== oldState.channelId ? newState.channelId : null;

      if (joinedChannelId && newState.member) {
        // Safety: lift a leftover knock mute/deafen if they reconnected after one.
        await roomManager.clearKnockMute(newState.member);

        if (joinedChannelId === privateLobbyId) {
          // JOIN-TO-CREATE: spin up a private room.
          await roomManager.createRoom(newState.member, 'private');
        }
        else if (joinedChannelId === publicLobbyId) {
          // JOIN-TO-CREATE: spin up a public room.
          await roomManager.createRoom(newState.member, 'public');
        }
        else {
          // KNOCK: if this is a tracked private room and they aren't a member,
          // handleKnock bounces them to the waiting room and asks for approval.
          // (Non-room channels are ignored inside handleKnock.)
          await roomManager.handleKnock(newState.member, joinedChannelId);
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
