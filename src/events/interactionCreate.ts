import { Events, MessageFlags, type Client } from 'discord.js';
import * as setup from '../commands/setup';
import { GuildConfigStore } from '../store/guildConfigStore';

export function registerInteractionCreate(client: Client, guildConfig: GuildConfigStore): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
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
