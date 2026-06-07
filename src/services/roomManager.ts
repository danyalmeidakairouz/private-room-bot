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
import { KnockMuteStore } from '../store/knockMuteStore';
import { generateRoomName } from '../util/nameGenerator';
import { BUTTON_IDS, DEFAULTS } from '../constants';
import { playKnock } from './knockSound';

export class RoomManager {
  private readonly client: Client;
  private readonly guildConfig: GuildConfigStore;
  private readonly tempRooms: TempRoomStore;
  private readonly creating = new Set<string>();
  private readonly pendingCleanup = new Set<string>();
  // Knockers currently being processed (debounce rapid re-joins), keyed by user id.
  private readonly knocking = new Set<string>();
  // Users the bot is actively admitting into a room (`guildId:userId`), so the
  // approval-move doesn't get treated as a fresh knock.
  private readonly admitting = new Set<string>();
  // Users we server-muted/deafened for a knock but couldn't un-mute yet (they
  // disconnected mid-hold). Cleared when they next reconnect — a server-mute
  // persists across sessions otherwise. Backed by knockMuteStore so a restart
  // mid-knock can still lift it.
  private readonly knockMuted = new Set<string>();
  private readonly knockMuteStore: KnockMuteStore;
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    client: Client,
    guildConfig: GuildConfigStore,
    tempRooms: TempRoomStore,
    knockMuteStore: KnockMuteStore,
  ) {
    this.client = client;
    this.guildConfig = guildConfig;
    this.tempRooms = tempRooms;
    this.knockMuteStore = knockMuteStore;
    // Reload any unfinished knock-mutes so they're lifted on the user's next join.
    for (const userId of knockMuteStore.all()) {
      this.knockMuted.add(userId);
    }
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
            // Anyone may SEE and CONNECT — clicking the channel is the "knock". The
            // bot instantly mutes/deafens a non-member, plays a knock, and moves
            // them to the waiting room. Speak is denied so a non-member can't TALK —
            // but note they can still HEAR until the bot bounces them, and if the bot
            // is offline they could sit and listen. That's the tradeoff of the
            // join-to-knock model. The room role grants Speak back to members.
            id: guild.roles.everyone.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
            deny: [PermissionFlagsBits.Speak],
          },
          {
            // The bot keeps explicit access so it can move members, mute/deafen a
            // knocker, post messages, create the invite, play the knock sound
            // (Connect + Speak), and delete the channel.
            id: me.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
              PermissionFlagsBits.MuteMembers,
              PermissionFlagsBits.DeafenMembers,
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

    // Welcome message in the room's own chat (seen by connected members). The
    // Approve/Deny prompt for a knock will also land here.
    const channelMessage =
      `🔒 Welcome to your private room **${name}**!\n` +
      `• Members can drag friends in or share this invite: ${invite?.url ?? '(invite unavailable)'}\n` +
      `• Anyone who clicks this channel "knocks": they're briefly held (you'll hear a knock) ` +
      `and sent to the waiting room. Approve them right here to pull them in.`;
    await channel.send({ content: channelMessage }).catch(() => {});

    // DM the owner the shareable invite.
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

  // Routes the Approve/Deny buttons posted in a private room's chat.
  //   `${approve}:${channelId}:${userId}` / `${deny}:${channelId}:${userId}`
  async handleButton(interaction: ButtonInteraction): Promise<void> {
    const [action, channelId, userId] = interaction.customId.split(':');
    switch (action) {
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

  // A non-member joined a private room — treat it as a "knock": briefly hold them
  // (muted + deafened) while the knock sound plays, move them to the waiting room,
  // and ask the members inside to approve. Called from the voice-state handler.
  async handleKnock(member: GuildMember, channelId: string): Promise<void> {
    const room = this.tempRooms.get(channelId);
    // Only react to a non-member joining a tracked private room.
    if (!room || room.type !== 'private' || !room.roleId) {
      return;
    }
    if (member.user.bot || member.id === room.ownerId) {
      return;
    }
    if (member.roles.cache.has(room.roleId)) {
      return; // already an approved member
    }
    const admitKey = `${room.guildId}:${member.id}`;
    if (this.admitting.has(admitKey) || this.knocking.has(member.id)) {
      return; // we're already admitting them, or a knock is in flight
    }

    this.knocking.add(member.id);
    try {
      const guild = member.guild;
      const cfg = this.guildConfig.get(guild.id);
      const waitingRoomId = cfg?.waitingRoomChannelId;
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isVoiceBased()) {
        return;
      }

      console.log(`[RoomManager] Knock: ${member.user.tag} on "${channel.name}".`);

      // Silence their brief presence so they can't hear or be heard at the door.
      this.knockMuted.add(member.id);
      this.knockMuteStore.add(member.id);
      await member.voice.setDeaf(true).catch(() => {});
      await member.voice.setMute(true).catch(() => {});

      // Play the knock so the members inside hear it.
      void playKnock(channel);

      // Hold them "at the door" for a beat while the knock plays.
      await new Promise((resolve) => setTimeout(resolve, DEFAULTS.knockHoldMs));

      // Move them to the waiting room (or disconnect if none is configured), but
      // only if they're still sitting in the private room.
      const fresh = await guild.members.fetch(member.id).catch(() => null);
      if (fresh?.voice.channelId === channelId) {
        if (waitingRoomId) {
          await fresh.voice.setChannel(waitingRoomId).catch(() => {});
        }
        else {
          await fresh.voice.disconnect().catch(() => {});
          console.warn(`[RoomManager] Guild ${guild.id} has no waiting room — re-run /setup.`);
        }
      }

      // Lift the mute/deafen while they're still connected. If they disconnected
      // during the hold, leave them flagged so clearKnockMute() lifts it on their
      // next join (a server-mute persists across sessions otherwise).
      const after = await guild.members.fetch(member.id).catch(() => null);
      if (after?.voice.channelId) {
        await after.voice.setMute(false).catch(() => {});
        await after.voice.setDeaf(false).catch(() => {});
        this.knockMuted.delete(member.id);
        this.knockMuteStore.remove(member.id);
      }

      const waitingMention = waitingRoomId ? `<#${waitingRoomId}>` : 'the waiting room';
      await member
        .send(
          `🔔 You knocked on **${channel.name}**. Please wait in ${waitingMention} — ` +
            `a member there will approve you and you'll be moved in automatically.`,
        )
        .catch(() => {});

      // Ask the members inside to approve.
      const approveRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${BUTTON_IDS.approve}:${channelId}:${member.id}`)
          .setLabel('Approve')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${BUTTON_IDS.deny}:${channelId}:${member.id}`)
          .setLabel('Deny')
          .setEmoji('✖️')
          .setStyle(ButtonStyle.Danger),
      );
      const ownerInRoom = channel.members.has(room.ownerId);
      const ownerPing = ownerInRoom ? ` <@${room.ownerId}>` : '';
      const mentionUsers = ownerInRoom ? [member.id, room.ownerId] : [member.id];
      await channel
        .send({
          content:
            `🔔 <@${member.id}> is knocking to join **${channel.name}** — they're waiting in ` +
            `${waitingMention}. Any member currently in the room can approve.${ownerPing}`,
          components: [approveRow],
          allowedMentions: { users: mentionUsers },
        })
        .catch(() => {});
    }
    finally {
      this.knocking.delete(member.id);
    }
  }

  // Lift a leftover knock server-mute/deafen if the user disconnected before we
  // could clear it and has now reconnected. Called on every voice join.
  async clearKnockMute(member: GuildMember): Promise<void> {
    if (!this.knockMuted.has(member.id) || !member.voice.channelId) {
      return;
    }
    await member.voice.setMute(false).catch(() => {});
    await member.voice.setDeaf(false).catch(() => {});
    this.knockMuted.delete(member.id);
    this.knockMuteStore.remove(member.id);
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
    if (!guild || !room || !room.roleId || room.guildId !== guild.id) {
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

    const requester = await guild.members.fetch(requesterId).catch(() => null);

    if (!approved) {
      // Send the knocker out of the waiting room, if that's where they are.
      const waitingRoomId = this.guildConfig.get(guild.id)?.waitingRoomChannelId;
      if (requester?.voice.channelId && requester.voice.channelId === waitingRoomId) {
        await requester.voice.disconnect().catch(() => {});
      }
      await requester?.send(`✖️ Your request to join **${channel.name}** was denied.`).catch(() => {});
      await interaction
        .update({
          content: `✖️ Request from <@${requesterId}> was denied by <@${interaction.user.id}>.`,
          components: [],
        })
        .catch(() => {});
      return;
    }

    if (!requester) {
      await interaction
        .update({ content: 'The requester is no longer in this server.', components: [] })
        .catch(() => {});
      return;
    }

    // Already a member (e.g. a stale, superseded prompt) — nothing to do.
    if (requester.roles.cache.has(room.roleId)) {
      await interaction
        .update({
          content: `✅ <@${requesterId}> is already a member of **${channel.name}**.`,
          components: [],
        })
        .catch(() => {});
      return;
    }

    const waitingRoomId = this.guildConfig.get(guild.id)?.waitingRoomChannelId;
    // Only auto-move someone who's actually waiting; don't yank them out of a
    // channel they've since wandered into.
    const moveIn = !!requester.voice.channelId && requester.voice.channelId === waitingRoomId;

    // Mark them as being admitted so the move below isn't treated as a new knock.
    const admitKey = `${guild.id}:${requesterId}`;
    this.admitting.add(admitKey);
    try {
      await requester.roles
        .add(room.roleId)
        .catch(() => console.warn(`[RoomManager] Could not grant role ${room.roleId} to ${requesterId}.`));

      if (moveIn) {
        await requester.voice.setChannel(channel.id).catch(() => {});
      }
      // Clear any mute/deafen left over from the knock.
      await requester.voice.setMute(false).catch(() => {});
      await requester.voice.setDeaf(false).catch(() => {});
    }
    finally {
      // Keep the guard briefly so the post-move voice event doesn't re-knock.
      setTimeout(() => this.admitting.delete(admitKey), 5000);
    }

    await requester.send(`✅ You've been approved to join **${channel.name}**.`).catch(() => {});

    await interaction
      .update({
        content:
          `✅ <@${requesterId}> was approved by <@${interaction.user.id}> and ` +
          `${moveIn ? 'moved in' : 'can now join'}.`,
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
