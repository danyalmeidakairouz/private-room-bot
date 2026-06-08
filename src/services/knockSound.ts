import * as path from 'path';
import { createReadStream } from 'fs';
import sodium from 'libsodium-wrappers';
import { type VoiceBasedChannel } from 'discord.js';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';

// Pre-encoded OggOpus (48 kHz stereo) so playback needs no ffmpeg/opus encoder
// at runtime — @discordjs/voice streams the Opus packets straight through.
// __dirname is dist/services at runtime, so the asset sits two levels up.
const KNOCK_FILE = path.join(__dirname, '..', '..', 'assets', 'knock.ogg');

// Discord allows only ONE voice connection per guild for the bot. Track which
// guilds are mid-knock so a second overlapping request doesn't hijack and then
// destroy the connection the first one is still using.
const playingGuilds = new Set<string>();

/**
 * Join a voice channel, play the knock sound once, then leave. Best-effort —
 * any failure (permissions, encryption lib, codec) is logged and swallowed so
 * a missing sound never breaks the request-access flow.
 *
 * Each stage is logged so that, when no knock is heard, the host logs
 * (`journalctl -u private-room-bot`) reveal exactly where it failed: never
 * reaching Ready (permission / UDP / voice-region issue), never reaching
 * Playing (codec / asset issue), or reaching Idle with no audio (transport /
 * encryption issue).
 *
 * @param channel The voice channel to knock in.
 */
export async function playKnock(channel: VoiceBasedChannel): Promise<void> {
  const guildId = channel.guild.id;
  if (playingGuilds.has(guildId)) {
    return; // a knock is already playing in this guild — don't disturb it
  }
  playingGuilds.add(guildId);

  let connection: ReturnType<typeof joinVoiceChannel> | undefined;
  try {
    // libsodium initializes asynchronously; ensure it's ready before voice
    // encryption needs it, otherwise the first connection can fail.
    await sodium.ready;

    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    connection.on('error', (err) =>
      console.warn(`[knockSound] voice connection error in "${channel.name}":`, err.message),
    );

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    }
    catch {
      console.warn(
        `[knockSound] voice connection to "${channel.name}" never reached Ready (15s). ` +
          'Check the bot has Connect/Speak in the room and the host can reach Discord voice (UDP).',
      );
      return;
    }

    // noSubscriber: Play keeps the clip playing even if the subscriber state
    // flickers, so a momentary connection blip can't silently pause it.
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    player.on('error', (err) =>
      console.warn(`[knockSound] audio player error: ${err.message}`),
    );

    const resource = createAudioResource(createReadStream(KNOCK_FILE), {
      inputType: StreamType.OggOpus,
    });
    connection.subscribe(player);
    player.play(resource);

    // Confirm playback actually STARTS — distinguishes "never played" (codec /
    // asset) from "played but inaudible" (transport / encryption).
    try {
      await entersState(player, AudioPlayerStatus.Playing, 10_000);
    }
    catch {
      console.warn(
        '[knockSound] playback never started (player did not reach Playing) — ' +
          `likely a codec/asset problem reading ${KNOCK_FILE}.`,
      );
      return;
    }

    // Wait for the clip to finish before leaving.
    await entersState(player, AudioPlayerStatus.Idle, 15_000);
    console.log(`[knockSound] played knock in "${channel.name}".`);
  }
  catch (err) {
    console.warn('[knockSound] Could not play knock sound:', err);
  }
  finally {
    connection?.destroy();
    playingGuilds.delete(guildId);
  }
}
