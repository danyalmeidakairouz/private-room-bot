import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type CategoryChannel,
} from 'discord.js';
import { GuildConfigStore } from '../store/guildConfigStore';
import { DEFAULTS } from '../constants';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Set up the Join-to-Create lobby for temporary private voice rooms')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addRoleOption((o) =>
    o
      .setName('admin_role')
      .setDescription(
        'Temp role will sit just below this role (defaults to just below the bot)',
      )
      .setRequired(false),
  )
  .addChannelOption((o) =>
    o
      .setName('category')
      .setDescription('Category to create rooms under')
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(false),
  ) as SlashCommandBuilder;

export async function execute(
  interaction: ChatInputCommandInteraction,
  guildConfig: GuildConfigStore,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guild) {
    await interaction.editReply('This command must be used in a server.');
    return;
  }

  const guild = interaction.guild;

  try {
    const adminRole = interaction.options.getRole('admin_role');
    const category = interaction.options.getChannel('category') as CategoryChannel | null;

    let resolvedCategoryId: string;
    let categoryMention: string;

    if (category) {
      resolvedCategoryId = category.id;
      categoryMention = category.name;
    }
    else {
      const createdCategory = await guild.channels.create({
        name: DEFAULTS.categoryName,
        type: ChannelType.GuildCategory,
      });
      resolvedCategoryId = createdCategory.id;
      categoryMention = createdCategory.name;
    }

    const lobby = await guild.channels.create({
      name: DEFAULTS.lobbyChannelName,
      type: ChannelType.GuildVoice,
      parent: resolvedCategoryId,
    });

    guildConfig.set({
      guildId: guild.id,
      lobbyChannelId: lobby.id,
      categoryId: resolvedCategoryId,
      adminRoleId: adminRole?.id ?? null,
    });

    const me = await guild.members.fetchMe();

    // F8: Check the bot has the runtime permissions needed to manage temp rooms.
    const required = [
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.MoveMembers,
      PermissionFlagsBits.CreateInstantInvite,
    ];
    const missingPerms = required.filter((p) => !me.permissions.has(p));
    const permWarning =
      missingPerms.length > 0
        ? '\n\n⚠️ **Missing permissions:** The bot is missing required permissions (Manage Channels / Manage Roles / Move Members / Create Invite) — grant them or temporary rooms won\'t be created correctly.'
        : '';

    let hierarchyWarning = '';
    if (adminRole && me.roles.highest.position <= adminRole.position) {
      hierarchyWarning =
        '\n\n⚠️ **Warning:** The bot\'s role must be dragged **above** the admin role in Server Settings → Roles so that temporary roles can be placed correctly below it.';
    }
    else {
      hierarchyWarning =
        '\n\n> Make sure the bot\'s role is positioned high in Server Settings → Roles so it can manage temporary roles.';
    }

    const adminRolePart = adminRole
      ? `\n• **Admin role:** <@&${adminRole.id}>`
      : '';

    await interaction.editReply(
      `✅ Setup complete!\n• **Lobby channel:** <#${lobby.id}>\n• **Category:** ${categoryMention}${adminRolePart}${permWarning}${hierarchyWarning}`,
    );
  }
  catch (err) {
    console.error('[setup] Error during /setup execution:', err);
    await interaction.editReply(
      'An error occurred while setting up the bot. Please check permissions and try again.',
    );
  }
}
