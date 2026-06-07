import { Events, MessageFlags, type Client } from 'discord.js';
import * as setup from '../commands/setup';
import { GuildConfigStore } from '../store/guildConfigStore';
import { RoomManager } from '../services/roomManager';
import { BUTTON_IDS, SELECT_IDS } from '../constants';

const ROOM_BUTTON_PREFIXES: readonly string[] = [
  BUTTON_IDS.knock,
  BUTTON_IDS.request,
  BUTTON_IDS.approve,
  BUTTON_IDS.deny,
];

const ROOM_SELECT_PREFIXES: readonly string[] = [SELECT_IDS.pick];

export function registerInteractionCreate(
  client: Client,
  guildConfig: GuildConfigStore,
  roomManager: RoomManager,
): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      // Knock/approval buttons.
      if (interaction.isButton()) {
        const prefix = interaction.customId.split(':')[0];
        if (ROOM_BUTTON_PREFIXES.includes(prefix)) {
          await roomManager.handleButton(interaction);
        }
        return;
      }

      // Room-picker select menu (shown after the knock button is pressed).
      if (interaction.isStringSelectMenu()) {
        const prefix = interaction.customId.split(':')[0];
        if (ROOM_SELECT_PREFIXES.includes(prefix)) {
          await roomManager.handleSelectMenu(interaction);
        }
        return;
      }

      if (!interaction.isChatInputCommand()) return;

      if (interaction.commandName === setup.data.name) {
        await setup.execute(interaction, guildConfig);
      }
    }
    catch (err) {
      console.error('[interactionCreate] Unhandled error:', err);
      if (!interaction.isRepliable()) return;
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content: 'Something went wrong.', flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
    }
  });
}
