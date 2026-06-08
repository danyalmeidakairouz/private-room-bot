import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { GuildConfigStore } from '../store/guildConfigStore';
import { parseRoomNames } from '../util/roomNames';
import { memberOutranksBot, OUTRANK_DENIED_MESSAGE } from '../util/permissions';

// These commands let a server admin curate the pool of names that new public /
// private voice rooms are randomly given. They are visible to everyone, but
// access is enforced at runtime: only the server owner, members with the
// Administrator permission, or members whose highest role sits above the bot's
// role may use them (see memberOutranksBot). Discord cannot gate a command by
// role position natively, so this lives in code rather than in
// default_member_permissions.

type RoomNameType = 'public' | 'private';

function fieldFor(type: RoomNameType): 'publicRoomNames' | 'privateRoomNames' {
  return type === 'public' ? 'publicRoomNames' : 'privateRoomNames';
}

function buildData(name: string, type: RoomNameType): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(`Set the names new ${type} voice rooms are randomly given`)
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('names')
        .setDescription(
          'Comma-separated names; omit to view the current list, or pass blank text to clear',
        )
        .setRequired(false),
    ) as SlashCommandBuilder;
}

async function executeRoomNames(
  interaction: ChatInputCommandInteraction,
  guildConfig: GuildConfigStore,
  type: RoomNameType,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guild) {
    await interaction.editReply('This command must be used in a server.');
    return;
  }

  if (!(await memberOutranksBot(interaction))) {
    await interaction.editReply(OUTRANK_DENIED_MESSAGE);
    return;
  }

  const cfg = guildConfig.get(interaction.guild.id);
  if (!cfg) {
    await interaction.editReply('Please run **/setup** first, then set room names.');
    return;
  }

  const field = fieldFor(type);
  const raw = interaction.options.getString('names');

  // No argument → show the current list.
  if (raw === null) {
    const current = cfg[field];
    if (current && current.length > 0) {
      await interaction.editReply(
        `Current ${type} room names (${current.length}): ${current.join(', ')}\n` +
          `Run this command with \`names:\` to replace them.`,
      );
    }
    else {
      await interaction.editReply(
        `No custom ${type} room names are set — new ${type} rooms get random names. ` +
          `Pass \`names:\` (comma-separated) to set them.`,
      );
    }
    return;
  }

  const parsed = parseRoomNames(raw);
  guildConfig.set({ ...cfg, [field]: parsed.length > 0 ? parsed : undefined });

  if (parsed.length > 0) {
    await interaction.editReply(
      `✅ Saved ${parsed.length} ${type} room name(s): ${parsed.join(', ')}\n` +
        `New ${type} rooms will each be given a random one of these.`,
    );
  }
  else {
    await interaction.editReply(
      `🧹 Cleared the ${type} room name list — new ${type} rooms will get random names again.`,
    );
  }
}

export const publicChannelsNames = {
  data: buildData('public-channels-names', 'public'),
  execute: (interaction: ChatInputCommandInteraction, guildConfig: GuildConfigStore): Promise<void> =>
    executeRoomNames(interaction, guildConfig, 'public'),
};

export const privateChannelsNames = {
  data: buildData('private-channels-names', 'private'),
  execute: (interaction: ChatInputCommandInteraction, guildConfig: GuildConfigStore): Promise<void> =>
    executeRoomNames(interaction, guildConfig, 'private'),
};
