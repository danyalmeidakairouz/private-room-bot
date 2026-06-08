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

// Access is intentionally NOT gated by setDefaultMemberPermissions — it is
// governed entirely by Discord's command-permissions UI (Server Settings →
// Integrations), i.e. the server's own role-management system. Room-name lists
// are managed by the /public-channels-names and /private-channels-names commands.
export const data: SlashCommandBuilder = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Set up the Join-to-Create lobby for temporary private voice rooms')
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

    // Room-name lists are managed by /public-channels-names and
    // /private-channels-names; carry them forward so re-running /setup never
    // wipes an admin's curated lists.
    const publicRoomNames = oldCfg?.publicRoomNames;
    const privateRoomNames = oldCfg?.privateRoomNames;

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
    // Outsiders request access to a private room here by clicking the room card's
    // "Request Access" button. Buttons need no special permission — anyone who can
    // see the message can click — which is why this replaces the old context-menu
    // command that effectively only worked for admins. @everyone keeps ViewChannel
    // + ReadMessageHistory so the cards and their buttons are always visible.
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
          'gets its own card below — click its **Request Access** button to ask to join. ' +
          'The people inside will hear a knock and can let you in.',
      })
      .catch(() => {});

    guildConfig.set({
      guildId: guild.id,
      publicLobbyChannelId: publicLobby.id,
      privateLobbyChannelId: privateLobby.id,
      knockChannelId: knockChannel.id,
      categoryId: resolvedCategoryId,
      adminRoleId: adminRole?.id ?? null,
      publicRoomNames,
      privateRoomNames,
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

    const describeNames = (list: string[] | undefined): string =>
      list && list.length > 0
        ? `${list.length} custom (${list.slice(0, 5).join(', ')}${list.length > 5 ? ', …' : ''})`
        : 'random names';
    const publicNamesPart = `\n• **Public room names:** ${describeNames(publicRoomNames)}`;
    const privateNamesPart = `\n• **Private room names:** ${describeNames(privateRoomNames)}`;

    await interaction.editReply(
      `✅ Setup complete!\n• **Join for Public:** <#${publicLobby.id}>\n• **Join for Private:** <#${privateLobby.id}>\n• **Request to join:** <#${knockChannel.id}>\n• **Category:** ${categoryMention}${adminRolePart}${publicNamesPart}${privateNamesPart}${permWarning}${hierarchyWarning}`,
    );
  }
  catch (err) {
    console.error('[setup] Error during /setup execution:', err);
    await interaction.editReply(
      'An error occurred while setting up the bot. Please check permissions and try again.',
    );
  }
}
