import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type VoiceChannel,
} from 'discord.js';
import { GuildConfigStore, type GuildConfig } from '../store/guildConfigStore';
import { TempRoomStore, type RoomType, type TempRoom } from '../store/tempRoomStore';
import { generateRoomName } from '../util/nameGenerator';
import { BUTTON_IDS, DEFAULTS } from '../constants';

export class RoomManager {
  private readonly client: Client;
  private readonly guildConfig: GuildConfigStore;
  private readonly tempRooms: TempRoomStore;
  private readonly creating = new Set<string>();
  private readonly pendingCleanup = new Set<string>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(client: Client, guildConfig: GuildConfigStore, tempRooms: TempRoomStore) {
    this.client = client;
    this.guildConfig = guildConfig;
    this.tempRooms = tempRooms;
  }

  static computeRolePosition(botHighestPosition: number, adminPosition: number | null): number {
    const target =
      (adminPosition !== null ? Math.min(adminPosition, botHighestPosition) : botHighestPosition) -
      1;
    return Math.max(target, 1);
  }

  async createRoom(member: GuildMember, type: RoomType): Promise<void> {
    if (this.creating.has(member.id)) {
      return;
    }
    this.creating.add(member.id);
    try {
      const guild = member.guild;
      const cfg = this.guildConfig.get(guild.id);
      if (!cfg) {
        return;
      }

      console.log(
        `[RoomManager] ${type} lobby join detected — creating a room for ${member.user.tag}.`,
      );

      // Enforce per-owner and per-guild room caps before doing any API calls.
      const existing = this.tempRooms.byGuild(guild.id);
      if (existing.some((r) => r.ownerId === member.id)) {
        console.log(
          `[RoomManager] ${member.user.tag} already owns an active room — skipping. ` +
            `Clear data/temp-rooms.json if this is stale.`,
        );
        return; // member already owns an active room
      }
      if (existing.length >= DEFAULTS.maxRoomsPerGuild) {
        console.warn(
          `[RoomManager] Guild ${guild.id} hit the temp-room cap (${DEFAULTS.maxRoomsPerGuild}).`,
        );
        return;
      }

      if (type === 'public') {
        await this.createPublicRoom(member, cfg);
      }
      else {
        await this.createPrivateRoom(member, cfg);
      }
    } catch (err) {
      console.error('[RoomManager] Unexpected error in createRoom:', err);
    } finally {
      this.creating.delete(member.id);
    }
  }

  // Private room: role-gated. Outsiders may VIEW the room but cannot Connect;
  // they knock via the Request-to-Join button and a member approves.
  private async createPrivateRoom(member: GuildMember, cfg: GuildConfig): Promise<void> {
    const guild = member.guild;
    const name = generateRoomName();

    // Compute a safe role position below the bot's highest role and optionally below the admin role.
    const me = await guild.members.fetchMe();
    const botHighest = me.roles.highest.position;
    const adminPos =
      cfg.adminRoleId ? (guild.roles.cache.get(cfg.adminRoleId)?.position ?? null) : null;
    const position = RoomManager.computeRolePosition(botHighest, adminPos);

    // Create the private room role.
    const role = await guild.roles.create({
      name,
      mentionable: false,
      hoist: false,
      reason: `Temp room for ${member.user.tag}`,
    });
    await role.setPosition(position).catch(() => {
      console.warn(
        `[RoomManager] Could not set role position for ${role.id} — hierarchy too tight.`,
      );
    });

    // Create the channel in a try/catch so a failure here doesn't leave the role we
    // just created orphaned — at this point there is no TempRoom record yet, so the
    // sweeper could never reconcile it.
    let channel: VoiceChannel;
    try {
      channel = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: cfg.categoryId ?? undefined,
        permissionOverwrites: [
          {
            // Outsiders can SEE the private room and read its text chat (so they can
            // knock via the Request-to-Join button) but are denied Connect — they
            // cannot join. ReadMessageHistory guarantees the knock button is visible
            // even if the category/guild default denies it.
            id: guild.roles.everyone.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.Connect],
          },
          {
            // The bot must keep explicit access to the channel it creates so the
            // @everyone overwrite never blocks it from moving the owner in, creating
            // the invite, posting messages, or deleting the channel.
            id: me.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.MoveMembers,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.CreateInstantInvite,
              PermissionFlagsBits.SendMessages,
            ],
          },
          {
            id: role.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ],
          },
          {
            id: member.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
              PermissionFlagsBits.MoveMembers,
            ],
          },
        ],
        reason: 'Temporary private voice room',
      });
    }
    catch (err) {
      console.error(
        `[RoomManager] Failed to create private channel "${name}" — deleting orphan role ${role.id}. Error:`,
        err,
      );
      await role.delete('Private room channel creation failed').catch(() => {});
      return;
    }

    // Persist the record before the move so cleanup can act on it even if the move fails.
    const roomRecord: TempRoom = {
      channelId: channel.id,
      roleId: role.id,
      ownerId: member.id,
      guildId: guild.id,
      createdAt: Date.now(),
      type: 'private',
    };
    this.tempRooms.add(roomRecord);

    // Log a warning if role assignment fails (e.g. missing Manage Roles permission).
    await member.roles
      .add(role)
      .catch(() => console.warn(`[RoomManager] Could not assign role ${role.id} to ${member.id}.`));

    // Move owner into the channel; on failure roll back the created resources.
    try {
      await member.voice.setChannel(channel);
    } catch (err) {
      console.error(
        `[RoomManager] Failed to move ${member.user.tag} into "${name}" — rolling back. Error:`,
        err,
      );
      await this.destroyRoom(channel.id, guild);
      return;
    }

    console.log(
      `[RoomManager] Created private room "${name}" for ${member.user.tag} and moved them in.`,
    );

    const invite = await channel
      .createInvite({ maxAge: DEFAULTS.inviteMaxAgeSec, maxUses: 0 })
      .catch(() => null);

    // Posted to the voice channel's built-in text chat. Members share the invite;
    // anyone who can see the room (but not join) presses Request to Join to knock.
    const inviteRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${BUTTON_IDS.request}:${channel.id}`)
        .setLabel('Request to Join')
        .setEmoji('🔔')
        .setStyle(ButtonStyle.Primary),
    );
    const channelMessage =
      `🔒 Welcome to your private room **${name}**!\n` +
      `• Invite friends: ${invite?.url ?? '(invite unavailable)'} — or drag them in.\n` +
      `• Anyone can **see** this room but must be approved to join. ` +
      `Not in the room? Press **Request to Join** and a member will let you in.`;
    await channel.send({ content: channelMessage, components: [inviteRow] }).catch(() => {});

    // DM the owner the shareable details (the interactive buttons live in the channel chat).
    await member
      .send(`🔒 Your private room **${name}** is ready: ${invite?.url ?? '(invite unavailable)'}`)
      .catch(() => {});
  }

  // Public room: no role, no gating — anyone can join. Deleted when everyone leaves.
  private async createPublicRoom(member: GuildMember, cfg: GuildConfig): Promise<void> {
    const guild = member.guild;
    const name = generateRoomName();
    const me = await guild.members.fetchMe();

    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: cfg.categoryId ?? undefined,
      permissionOverwrites: [
        {
          // Public room: anyone may view, connect, and speak.
          id: guild.roles.everyone.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
          ],
        },
        {
          id: me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.SendMessages,
          ],
        },
      ],
      reason: 'Temporary public voice room',
    });

    // Persist before the move so cleanup can act on it even if the move fails.
    const roomRecord: TempRoom = {
      channelId: channel.id,
      roleId: null,
      ownerId: member.id,
      guildId: guild.id,
      createdAt: Date.now(),
      type: 'public',
    };
    this.tempRooms.add(roomRecord);

    try {
      await member.voice.setChannel(channel);
    } catch (err) {
      console.error(
        `[RoomManager] Failed to move ${member.user.tag} into public room "${name}" — rolling back. Error:`,
        err,
      );
      await this.destroyRoom(channel.id, guild);
      return;
    }

    console.log(
      `[RoomManager] Created public room "${name}" for ${member.user.tag} and moved them in.`,
    );

    await channel
      .send(
        `🔊 Public room **${name}** is open — anyone can join. ` +
          `It will be deleted automatically once everyone leaves.`,
      )
      .catch(() => {});
  }

  // Routes the private-room knock/approval buttons. customId formats:
  //   `${request}:${channelId}`            — an outsider knocks
  //   `${approve}:${channelId}:${userId}`  — a member approves the requester
  //   `${deny}:${channelId}:${userId}`     — a member denies the requester
  async handleButton(interaction: ButtonInteraction): Promise<void> {
    const [action, channelId, userId] = interaction.customId.split(':');
    switch (action) {
      case BUTTON_IDS.request:
        await this.handleJoinRequest(interaction, channelId);
        break;
      case BUTTON_IDS.approve:
        await this.handleApproval(interaction, channelId, userId, true);
        break;
      case BUTTON_IDS.deny:
        await this.handleApproval(interaction, channelId, userId, false);
        break;
      default:
        // Unreachable in practice (interactionCreate only routes known prefixes),
        // but acknowledge defensively so a future routing drift can never hang.
        await interaction.deferUpdate().catch(() => {});
        break;
    }
  }

  // An outsider knocked — post an approval prompt in the room's chat for members to act on.
  private async handleJoinRequest(interaction: ButtonInteraction, channelId: string): Promise<void> {
    const guild = interaction.guild;
    const room = this.tempRooms.get(channelId);
    if (!guild || !room || room.type !== 'private' || !room.roleId) {
      await interaction
        .reply({ content: 'This room is no longer accepting requests.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isVoiceBased()) {
      await interaction
        .reply({ content: 'This room no longer exists.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }

    // Already a member? Nothing to request.
    const requester = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (requester?.roles.cache.has(room.roleId)) {
      await interaction
        .reply({ content: 'You can already join this room.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }

    const approveRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${BUTTON_IDS.approve}:${channelId}:${interaction.user.id}`)
        .setLabel('Approve')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${BUTTON_IDS.deny}:${channelId}:${interaction.user.id}`)
        .setLabel('Deny')
        .setEmoji('✖️')
        .setStyle(ButtonStyle.Danger),
    );

    // Posted in the voice channel's chat so any current member sees it and can decide.
    await interaction
      .reply({
        content:
          `🔔 <@${interaction.user.id}> would like to join this private room. ` +
          'Any member currently in the room can approve.',
        components: [approveRow],
        allowedMentions: { users: [interaction.user.id] },
      })
      .catch(() => {});
  }

  // A member pressed Approve/Deny on a knock. Only people currently in the room may decide.
  private async handleApproval(
    interaction: ButtonInteraction,
    channelId: string,
    requesterId: string,
    approved: boolean,
  ): Promise<void> {
    const guild = interaction.guild;
    const room = this.tempRooms.get(channelId);
    if (!guild || !room || !room.roleId) {
      await interaction
        .update({ content: 'This room is no longer available.', components: [] })
        .catch(() => {});
      return;
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isVoiceBased()) {
      await interaction
        .update({ content: 'This room no longer exists.', components: [] })
        .catch(() => {});
      return;
    }

    // Only people currently connected to the room may approve or deny.
    if (!channel.members.has(interaction.user.id)) {
      await interaction
        .reply({
          content: 'Only members currently in the room can approve or deny requests.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    if (!approved) {
      await interaction
        .update({
          content: `✖️ Request from <@${requesterId}> was denied by <@${interaction.user.id}>.`,
          components: [],
        })
        .catch(() => {});
      return;
    }

    const requester = await guild.members.fetch(requesterId).catch(() => null);
    if (!requester) {
      await interaction
        .update({ content: 'The requester is no longer in this server.', components: [] })
        .catch(() => {});
      return;
    }

    await requester.roles
      .add(room.roleId)
      .catch(() => console.warn(`[RoomManager] Could not grant role ${room.roleId} to ${requesterId}.`));

    // If the requester is connected to a *different* voice channel, pull them into
    // the room; otherwise the role now lets them join on their own.
    if (requester.voice.channelId && requester.voice.channelId !== channel.id) {
      await requester.voice.setChannel(channel.id).catch(() => {});
    }

    // Best-effort DM so a requester who isn't watching the channel knows they're in.
    await requester
      .send(`✅ You've been approved to join **${channel.name}**.`)
      .catch(() => {});

    await interaction
      .update({
        content: `✅ <@${requesterId}> was approved by <@${interaction.user.id}> and can now join.`,
        components: [],
      })
      .catch(() => {});
  }

  scheduleCleanup(channelId: string, guild: Guild): void {
    // Safety: only act on channels we own — prevents accidental deletion of non-temp channels.
    if (!this.tempRooms.get(channelId)) {
      return;
    }
    if (this.pendingCleanup.has(channelId)) {
      return;
    }
    this.pendingCleanup.add(channelId);
    setTimeout(async () => {
      try {
        const ch = await guild.channels.fetch(channelId).catch(() => null);
        if (ch && ch.isVoiceBased() && ch.members.size === 0) {
          await this.destroyRoom(channelId, guild);
        }
      } finally {
        this.pendingCleanup.delete(channelId);
      }
    }, DEFAULTS.graceMs);
  }

  async destroyRoom(channelId: string, guild: Guild): Promise<void> {
    const room = this.tempRooms.get(channelId);
    await guild.channels.delete(channelId, 'Temp room empty').catch(() => {});
    if (room?.roleId) {
      await guild.roles.delete(room.roleId, 'Temp room closed').catch(() => {});
    }
    this.tempRooms.remove(channelId);
  }

  // F1: single source of truth for the per-room sweep logic.
  private async sweepOnce(): Promise<void> {
    for (const room of this.tempRooms.all()) {
      // Don't reap a freshly-created room — the owner may still be mid-move, so the
      // channel is momentarily empty. Events/the next sweep will handle it once settled.
      if (Date.now() - room.createdAt < DEFAULTS.graceMs) {
        continue;
      }

      // F2: try cache first; fall back to a fetch so we can purge records for guilds the bot left.
      let guild = this.client.guilds.cache.get(room.guildId) ?? null;
      if (!guild) {
        guild = await this.client.guilds.fetch(room.guildId).catch(() => null);
      }
      if (!guild) {
        // Bot is no longer in this guild — purge the stale record to prevent disk leaks.
        this.tempRooms.remove(room.channelId);
        continue;
      }

      const ch = await guild.channels.fetch(room.channelId).catch(() => null);
      if (!ch) {
        // Channel is gone — clean up orphaned role and remove the record.
        if (room.roleId) {
          await guild.roles.delete(room.roleId, 'Temp room closed').catch(() => {});
        }
        this.tempRooms.remove(room.channelId);
      } else if (ch.isVoiceBased() && ch.members.size === 0) {
        await this.destroyRoom(room.channelId, guild);
      }
      // Channel exists and has members — leave it; events will handle teardown.
    }
  }

  // F1: guarded interval start — called once from ready.ts after reconcile().
  startSweeper(): void {
    if (this.sweeper) {
      return;
    }
    this.sweeper = setInterval(() => {
      void this.sweepOnce();
    }, DEFAULTS.sweepIntervalMs);
  }

  // F1: reconcile on startup, then let startSweeper() handle periodic runs.
  async reconcile(): Promise<void> {
    await this.sweepOnce();
  }
}
