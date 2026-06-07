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
    // Snapshot any prior config so we can tear down the channels the last /setup
    // created (otherwise re-running leaves orphaned lobbies and a duplicate panel).
    const oldCfg = guildConfig.get(guild.id);

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

    const me = await guild.members.fetchMe();

    const publicLobby = await guild.channels.create({
      name: DEFAULTS.publicLobbyChannelName,
      type: ChannelType.GuildVoice,
      parent: resolvedCategoryId,
    });

    const privateLobby = await guild.channels.create({
      name: DEFAULTS.privateLobbyChannelName,
      type: ChannelType.GuildVoice,
      parent: resolvedCategoryId,
    });

    // Knock panel: a text channel everyone can see but not post in (bot only).
    // Outsiders press the button here to request access to a private room — they
    // can't reach a private voice channel's own chat, so the knock lives here.
    const knockChannel = await guild.channels.create({
      name: DEFAULTS.knockChannelName,
      type: ChannelType.GuildText,
      parent: resolvedCategoryId,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          deny: [PermissionFlagsBits.SendMessages],
        },
        {
          id: me.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
      ],
    });

    await knockChannel
      .send({
        content:
          '🔒 **Private rooms**\n' +
          'You can see private rooms but not join them directly. Each active private room ' +
          'gets its own message below — **right-click it → Apps → Request Access** to ask to ' +
          'join, and a member inside will approve you (they\'ll hear a knock).',
      })
      .catch(() => {});

    guildConfig.set({
      guildId: guild.id,
      publicLobbyChannelId: publicLobby.id,
      privateLobbyChannelId: privateLobby.id,
      knockChannelId: knockChannel.id,
      categoryId: resolvedCategoryId,
      adminRoleId: adminRole?.id ?? null,
    });

    // Best-effort: remove the previous run's bot-created lobby/knock channels so a
    // re-run doesn't orphan them or leave a second working knock panel. The
    // category is intentionally left alone (it may still hold active rooms).
    if (oldCfg) {
      const newIds = new Set([publicLobby.id, privateLobby.id, knockChannel.id]);
      const staleIds = [
        oldCfg.publicLobbyChannelId,
        oldCfg.privateLobbyChannelId,
        oldCfg.knockChannelId,
        oldCfg.lobbyChannelId,
      ];
      for (const staleId of staleIds) {
        if (staleId && !newIds.has(staleId)) {
          await guild.channels.delete(staleId, 'Replaced by /setup re-run').catch(() => {});
        }
      }
    }

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
      `✅ Setup complete!\n• **Join for Public:** <#${publicLobby.id}>\n• **Join for Private:** <#${privateLobby.id}>\n• **Request to join:** <#${knockChannel.id}>\n• **Category:** ${categoryMention}${adminRolePart}${permWarning}${hierarchyWarning}`,
    );
  }
  catch (err) {
    console.error('[setup] Error during /setup execution:', err);
    await interaction.editReply(
      'An error occurred while setting up the bot. Please check permissions and try again.',
    );
  }
}
