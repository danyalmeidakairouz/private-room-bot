import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
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
import { pickRoomName } from '../util/nameGenerator';
import { BUTTON_IDS, DEFAULTS } from '../constants';
import { playKnock } from './knockSound';

export class RoomManager {
  private readonly client: Client;
  private readonly guildConfig: GuildConfigStore;
  private readonly tempRooms: TempRoomStore;
  private readonly creating = new Set<string>();
  private readonly pendingCleanup = new Set<string>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

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

      // Clean up any now-empty room this member still owns. This is what lets you
      // hop straight from your own room into a lobby: the old room is empty the
      // instant you leave it, so we delete it and free the per-owner slot instead
      // of refusing to create the new one (the original move-into-lobby bug).
      for (const owned of this.tempRooms.byGuild(guild.id).filter((r) => r.ownerId === member.id)) {
        const ownedCh = await guild.channels.fetch(owned.channelId).catch(() => null);
        if (!ownedCh || (ownedCh.isVoiceBased() && ownedCh.members.size === 0)) {
          await this.destroyRoom(owned.channelId, guild);
        }
      }

      // Enforce per-owner and per-guild room caps before doing any API calls.
      const existing = this.tempRooms.byGuild(guild.id);
      if (existing.some((r) => r.ownerId === member.id)) {
        console.log(
          `[RoomManager] ${member.user.tag} already owns an active (non-empty) room — skipping.`,
        );
        return; // member still owns a room with people in it
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
    const name = pickRoomName(cfg.privateRoomNames);

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
            // the invite, posting messages, deleting the channel, or playing the
            // knock sound (Connect + Speak).
            id: me.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
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

    // Post a "card" for this room in the knock channel: an embed naming the room
    // plus a "Request Access" button anyone who can see the channel may click
    // (buttons need no special permission, unlike the old context-menu command).
    // The button's customId carries this channel's id so the knock routes straight
    // back here; the card's message id is stored so cleanup can delete it.
    if (cfg.knockChannelId) {
      const knockCh = await guild.channels.fetch(cfg.knockChannelId).catch(() => null);
      if (knockCh?.isTextBased()) {
        const cardEmbed = new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle(`🔒 ${name}`)
          .setDescription(
            'A private voice room. Click **Request Access** to ask to join — the people ' +
              'inside will hear a knock and can let you in.',
          );
        const cardRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`${BUTTON_IDS.request}:${channel.id}`)
            .setLabel('Request Access')
            .setEmoji('🚪')
            .setStyle(ButtonStyle.Primary),
        );
        const card = await knockCh
          .send({ embeds: [cardEmbed], components: [cardRow] })
          .catch(() => null);
        if (card) {
          roomRecord.cardMessageId = card.id;
          roomRecord.cardChannelId = knockCh.id;
          this.tempRooms.add(roomRecord); // re-persist with the card location
        }
        else {
          console.warn(
            `[RoomManager] Could not post knock card for "${name}" — it won't be requestable until re-created.`,
          );
        }
      }
    }
    else {
      console.warn(
        `[RoomManager] Guild ${guild.id} has no knock channel — outsiders can't request to join. Re-run /setup.`,
      );
    }

    // Welcome message in the room's own chat (seen by connected members). The
    // Approve/Deny prompt for a knock will also land here.
    const channelMessage =
      `🔒 Welcome to your private room **${name}**!\n` +
      `• Members can drag friends in or share this invite: ${invite?.url ?? '(invite unavailable)'}\n` +
      `• Outsiders request access from the **🚪 request-to-join** channel — you'll get an **Allow In** prompt right here.`;
    await channel.send({ content: channelMessage }).catch(() => {});

    // DM the owner the shareable invite.
    await member
      .send(`🔒 Your private room **${name}** is ready: ${invite?.url ?? '(invite unavailable)'}`)
      .catch(() => {});
  }

  // Public room: no role, no gating — anyone can join. Deleted when everyone leaves.
  private async createPublicRoom(member: GuildMember, cfg: GuildConfig): Promise<void> {
    const guild = member.guild;
    const name = pickRoomName(cfg.publicRoomNames);
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

  // Routes the room buttons.
  //   `${request}:${channelId}`           — outsider knocks from the request-to-join panel
  //   `${allow}:${channelId}:${userId}`   — a member in the room lets the requester in
  async handleButton(interaction: ButtonInteraction): Promise<void> {
    const [action, channelId, requesterId] = interaction.customId.split(':');
    switch (action) {
      case BUTTON_IDS.request:
        await this.handleRequestButton(interaction, channelId);
        break;
      case BUTTON_IDS.allow:
        await this.handleAllow(interaction, channelId, requesterId);
        break;
      default:
        // Unreachable in practice (interactionCreate only routes known prefixes),
        // but acknowledge defensively so a future routing drift can never hang.
        await interaction.deferUpdate().catch(() => {});
        break;
    }
  }

  // "Request Access" button under a room's card in the request-to-join panel. Plays
  // a knock the people inside can hear and drops an "Allow In" prompt — carrying the
  // requester's name and avatar — into the room's own text chat.
  async handleRequestButton(interaction: ButtonInteraction, channelId: string): Promise<void> {
    // Defer immediately — the work below does several round-trips and would
    // otherwise risk blowing Discord's 3s interaction-ack window.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply('Please use this from within the server.').catch(() => {});
      return;
    }

    // The button's customId carries the room's channel id, so route straight to it.
    const room = this.tempRooms.get(channelId);
    if (!room || room.guildId !== guild.id || room.type !== 'private' || !room.roleId) {
      await interaction.editReply('That room is no longer available.').catch(() => {});
      return;
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isVoiceBased()) {
      await interaction.editReply('That room no longer exists.').catch(() => {});
      return;
    }

    const requester = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!requester) {
      await interaction.editReply('Could not verify your membership — please try again.').catch(() => {});
      return;
    }
    if (requester.roles.cache.has(room.roleId)) {
      await interaction
        .editReply(`You already have access to **${channel.name}** — just click it to join.`)
        .catch(() => {});
      return;
    }

    if (channel.members.size === 0) {
      await interaction
        .editReply(
          `Nobody is in **${channel.name}** right now to let you in. Try again when someone's there.`,
        )
        .catch(() => {});
      return;
    }

    const allowRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${BUTTON_IDS.allow}:${channel.id}:${requester.id}`)
        .setLabel('Allow In')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
    );

    const knockEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({
        name: `${requester.displayName} wants to join`,
        iconURL: requester.displayAvatarURL(),
      })
      .setThumbnail(requester.displayAvatarURL())
      .setDescription(
        `<@${requester.id}> is asking to join **${channel.name}**. ` +
          'Anyone currently in the room can let them in.',
      );

    // Ping the owner only if they're actually in the room, so we don't alert
    // someone who has left (the record outlives their presence until cleanup).
    const ownerInRoom = channel.members.has(room.ownerId);
    const sent = await channel
      .send({
        content: ownerInRoom ? `<@${room.ownerId}>` : undefined,
        embeds: [knockEmbed],
        components: [allowRow],
        allowedMentions: { users: ownerInRoom ? [room.ownerId] : [] },
      })
      .catch(() => null);

    if (!sent) {
      await interaction
        .editReply('Could not deliver your request to the room. Please try again shortly.')
        .catch(() => {});
      return;
    }

    await interaction
      .editReply(`✅ Your request to join **${channel.name}** was sent — a member there can let you in.`)
      .catch(() => {});

    // Play the knock sound so the people inside hear it. Fire-and-forget: joining,
    // playing and leaving can take several seconds and must not block the reply.
    void playKnock(channel);
  }

  // A member pressed "Allow In". Only someone currently connected to the room may
  // let the requester in; we grant the room role and move them straight into the channel.
  private async handleAllow(
    interaction: ButtonInteraction,
    channelId: string,
    requesterId: string,
  ): Promise<void> {
    const guild = interaction.guild;
    const room = this.tempRooms.get(channelId);
    if (!guild || !room || !room.roleId || room.guildId !== guild.id) {
      await interaction
        .update({ content: 'This room is no longer available.', embeds: [], components: [] })
        .catch(() => {});
      return;
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isVoiceBased()) {
      await interaction
        .update({ content: 'This room no longer exists.', embeds: [], components: [] })
        .catch(() => {});
      return;
    }

    // Only people currently connected to the room may let someone in. Outsiders can
    // see this voice channel's text chat, so the connection check is the real gate.
    if (!channel.members.has(interaction.user.id)) {
      await interaction
        .reply({
          content: 'Only members currently in the room can let people in.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const requester = await guild.members.fetch(requesterId).catch(() => null);
    if (!requester) {
      await interaction
        .update({
          content: 'The requester is no longer in this server.',
          embeds: [],
          components: [],
        })
        .catch(() => {});
      return;
    }

    await requester.roles
      .add(room.roleId)
      .catch(() => console.warn(`[RoomManager] Could not grant role ${room.roleId} to ${requesterId}.`));

    // Discord only lets us move a member who is already connected to some voice
    // channel. If they're connected elsewhere, pull them in; if they're already
    // here, nothing to do; if they're not in voice at all, the role lets them click in.
    let moved = false;
    if (requester.voice.channelId === channel.id) {
      moved = true;
    }
    else if (requester.voice.channelId) {
      moved = await requester.voice
        .setChannel(channel.id)
        .then(() => true)
        .catch(() => false);
    }

    // Best-effort DM so a requester who isn't watching the channel knows the outcome.
    await requester
      .send(
        moved
          ? `✅ You've been let into **${channel.name}**.`
          : `✅ You've been approved for **${channel.name}** — click it to join.`,
      )
      .catch(() => {});

    await interaction
      .update({
        content: `✅ <@${requesterId}> was let into **${channel.name}** by <@${interaction.user.id}>.`,
        embeds: [],
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
    // Remove the room's card from the channel it was posted in (stored on the
    // record, so re-running /setup to a new knock channel can't orphan it).
    if (room?.cardMessageId) {
      const cardChannelId = room.cardChannelId ?? this.guildConfig.get(guild.id)?.knockChannelId;
      if (cardChannelId) {
        const knockCh = await guild.channels.fetch(cardChannelId).catch(() => null);
        if (knockCh?.isTextBased()) {
          await knockCh.messages.delete(room.cardMessageId).catch(() => {});
        }
      }
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
