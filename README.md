# Private Room Bot

A discord.js v14 bot that turns two "Join to Create" lobby voice channels into temporary **public** and **private** voice rooms. `/setup` creates a **🔊 Join for Public** and a **🔒 Join for Private** lobby under one category. Joining either lobby spins up a freshly-named room and moves the creator in; when everyone leaves, the room (and, for private rooms, its temporary role) is deleted automatically.

- **Public rooms** — no role, no gate: anyone can see and join. Deleted as soon as the last person leaves.
- **Private rooms** — anyone can **click to join**, but a non-member is instantly muted/deafened, a **knock sound** plays for the people inside, and they're shunted to a **⏳ Waiting Room**. A member then **Approves** them in the room's chat and they're auto-moved in. Only the room role can actually speak.

---

## Features

- **One-command setup** — `/setup` creates both lobby channels (public + private) under one category and stores your guild configuration.
- **Public & private rooms** — a **🔊 Join for Public** lobby (open to all) and a **🔒 Join for Private** lobby (role-gated).
- **Click-to-knock + waiting room** — clicking a private channel *is* the knock. The non-member is briefly muted/deafened (an audible **knock sound** plays for the people inside), then moved to a **⏳ Waiting Room**. A member clicks **Approve** in the room's chat and the knocker is auto-moved in.
- **Instant cleanup** — a room is deleted the moment its last member leaves.
- **Auto-generated room names** — random `Adjective-Noun-XXX` format (e.g. `Brave-Otter-7K2`).
- **Per-room temporary role** (private only) — gates who can join; automatically cleaned up when the room empties. Public rooms use no role.
- **Invite link generation** — 24-hour invite posted in the private room's chat and DMed to the creator.
- **Grace period** — rooms are deleted after a short delay (5 s default) once empty, to handle brief disconnects.
- **Periodic orphan sweep** — a background sweep removes any stale rooms and roles every 60 s.
- **Guild-scoped storage** — configuration and active rooms are persisted to JSON files on disk (no external database needed).

---

## Prerequisites

- **Node.js 18+**
- A **Discord application** with a bot token — create one at the [Discord Developer Portal](https://discord.com/developers/applications).

---

## Discord Developer Portal Setup

### 1. Create a Bot and Get Your Token

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and click **New Application**.
2. Give it a name (e.g. `PrivateRoomBot`) and confirm.
3. Go to the **Bot** tab, click **Add Bot**.
4. Under **Token**, click **Reset Token** and copy it — this is your `DISCORD_TOKEN`.
5. Copy the **Application ID** from the **General Information** tab — this is your `CLIENT_ID`.

### 2. Enable Privileged Intents

Still on the **Bot** tab, scroll to **Privileged Gateway Intents** and enable:

| Intent | Required |
|---|---|
| **Server Members Intent** | **Yes — must be ON** |
| Presence Intent | No |
| Message Content Intent | No |

The bot uses the Server Members Intent to resolve guild member data when assigning roles.

### 3. Invite the Bot to Your Server

Build an OAuth2 URL with the required scopes and permissions:

**Scopes:** `bot applications.commands`

**Bot Permissions** (and their bit values):

| Permission | Bit value |
|---|---|
| View Channel | 1,024 |
| Create Instant Invite | 1 |
| Manage Channels | 16 |
| Manage Roles | 268,435,456 |
| Connect | 1,048,576 |
| Speak | 2,097,152 |
| Move Members | 16,777,216 |
| Mute Members | 4,194,304 |
| Deafen Members | 8,388,608 |
| Send Messages | 2,048 |
| **Total** | **300,944,401** |

Calculation: `1024 + 1 + 16 + 268435456 + 1048576 + 2097152 + 16777216 + 4194304 + 8388608 + 2048 = 300,944,401`

**Speak** lets the bot play the knock sound inside a room. **Mute Members** + **Deafen Members** let it silence a knocker for the fraction of a second they're at the door — these are **guild-level** moderation permissions, so they must come from the invite/role (a per-channel grant is not enough). **Move Members** is what moves a knocker to the waiting room and an approved user into the room.

Use this invite URL template (replace `YOUR_CLIENT_ID`):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=300944401&scope=bot+applications.commands
```

---

## ⚠️ Role Hierarchy (Critical)

Discord only allows a bot to manage roles that are **strictly below its own highest role** in the server hierarchy. The `Administrator` permission does **not** bypass this restriction.

**After inviting the bot:**

1. Go to **Server Settings → Roles**.
2. Drag the bot's role **above** any admin/staff roles you plan to pass to `/setup`, and above where temporary room roles should sit.
3. The bot will warn you during `/setup` if its role is positioned too low.

If the bot cannot create or delete roles, the role hierarchy is almost always the cause.

---

## Install and Configure

```bash
git clone <repo-url>
cd private-room-bot
npm install
```

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_TOKEN=your-bot-token-here
CLIENT_ID=your-application-id-here

# Recommended for development — instant slash command registration (guild-scoped)
# Leave empty for global registration (can take up to 1 hour to propagate)
GUILD_ID=your-test-guild-id-here

# Optional: directory for JSON data files (defaults to ./data)
DATA_DIR=./data
```

Register the `/setup` slash command:

```bash
npm run deploy
```

> Re-run `npm run deploy` after pulling an update that changes the commands (this version also removes the old **Request Access** right-click command). The knock sound ships as a pre-encoded `assets/knock.ogg`, so **no ffmpeg install is needed**.

Start the bot:

```bash
# Development (tsx watch — restarts on file changes)
npm run dev

# Production
npm run build && npm start
```

---

## Usage

### Initial Setup

In your Discord server, run the `/setup` slash command. Optional parameters:

| Parameter | Description | Default |
|---|---|---|
| `admin_role` | Role to whitelist as room admin (private temp roles sit just below it) | None |
| `category` | Name of the category to create the lobbies under | `Voice Rooms` |

This creates the **🔊 Join for Public** and **🔒 Join for Private** lobby channels, plus a **⏳ Waiting Room** voice channel, under the specified (or new) category, and stores your guild configuration.

> **Re-running `/setup`** is safe: it rebuilds the lobby + waiting-room channels and automatically deletes the previous run's bot-created lobby/waiting/knock channels (the category is left alone in case it still holds active rooms).

### Creating a public room

1. Any member joins the **🔊 Join for Public** lobby.
2. The bot creates a new voice channel (e.g. `Brave-Otter-7K2`) that **anyone** can see and join, and moves the member in.
3. When the last person leaves, the channel is deleted.

### Creating a private room

1. Any member joins the **🔒 Join for Private** lobby.
2. The bot instantly:
   - Creates a voice channel where `@everyone` can **see and connect** but is denied **Speak** (so a non-member who joins can't talk).
   - Creates a matching temporary role (placed just below the admin role), assigns it to the creator — the role is what grants **Speak**.
   - Moves the member into the new channel and DMs them a 24-hour invite link.
3. Members drag friends in or share the invite. Anyone else just **clicks the channel** to knock (below).

### Joining a private room (click-to-knock)

1. A non-member **clicks the private channel** as if joining.
2. The bot **server-mutes + deafens** them for a fraction of a second while an audible **knock sound** plays for the people inside, then **moves them to the ⏳ Waiting Room** and DMs them.
3. An **Approve** / **Deny** prompt (pinging the owner if present) appears **in the room's chat**, where the connected members can see it.
4. Any member **currently in the room** presses **Approve** → the knocker is granted the role and **auto-moved in from the waiting room** (and DMed) — or **Deny**, which sends them out of the waiting room.

> **⚠️ Privacy tradeoff.** Because the channel now allows **Connect**, the room is enforced by the *bot*, not by Discord permissions. A non-member can't **talk** (Speak is denied), but they **can hear** for the brief moment before the bot bounces them — and if the **bot is offline**, an outsider could sit in the room and listen. This is the cost of the "click the channel to knock" model; if you need a room that stays private even when the bot is down, that requires the permission-gated (right-click) approach instead.

### Room deletion

A temporary room is deleted **the instant its last member leaves** — the voice channel and (for private rooms) its temporary role go away immediately.

---

## Project Structure

```
src/
  constants.ts            # Word lists (ADJECTIVES, NOUNS) and DEFAULTS config
  config.ts               # Environment variable loading and validation
  index.ts                # Entry point — creates the Discord client and registers events
  deploy-commands.ts      # One-off script to register slash commands with Discord
  commands/
    setup.ts              # /setup slash command builder and handler
  events/
    ready.ts              # client ready event — starts periodic orphan sweep
    voiceStateUpdate.ts   # lobbies → room creation, non-member join → knock, + cleanup
    interactionCreate.ts  # routes /setup and the Approve/Deny buttons
  services/
    roomManager.ts        # core orchestration — rooms/roles, knock flow, approval
    knockSound.ts         # joins a room and plays assets/knock.ogg via @discordjs/voice
  store/
    jsonStore.ts          # generic persistent JSON file store
    guildConfigStore.ts   # per-guild config (lobby ids, waiting room id, admin role)
    tempRoomStore.ts      # tracks active temp rooms (type: public|private, nullable role)
    knockMuteStore.ts     # remembers in-progress knock mutes so a restart can lift them
  util/
    nameGenerator.ts      # generates random Adjective-Noun-XXX room names
```

---

## Configuration Tunables

The `DEFAULTS` object in `src/constants.ts` controls the bot's built-in timing and naming:

| Key | Default | Description |
|---|---|---|
| `graceMs` | `0` | Delay before deleting an empty room (0 = instant; raise it to tolerate brief disconnects) |
| `inviteMaxAgeSec` | `86400` | Invite lifetime in seconds (24 hours) |
| `sweepIntervalMs` | `60000` | How often to run the orphan sweep (60 seconds) |
| `publicLobbyChannelName` | `🔊 Join for Public` | Default name for the public lobby channel |
| `privateLobbyChannelName` | `🔒 Join for Private` | Default name for the private lobby channel |
| `waitingRoomChannelName` | `⏳ Waiting Room` | Default name for the waiting-room channel |
| `knockHoldMs` | `1200` | How long a knocker is held (muted/deafened) while the knock plays, before being moved to the waiting room |
| `categoryName` | `Voice Rooms` | Default name for the voice category |

To change these, edit the values in `src/constants.ts` before building.

---

## Hosting / Deployment

The bot is a persistent process (a long-lived Discord gateway connection), so it
needs an **always-on** host with **persistent disk** — not a serverless platform.
For a free Google Cloud `e2-micro` VM, see [`deploy/DEPLOY-GCP.md`](deploy/DEPLOY-GCP.md)
(uses the systemd unit in [`deploy/private-room-bot.service`](deploy/private-room-bot.service)).

### Docker

A multi-stage [`Dockerfile`](Dockerfile) is included (runs as a non-root user,
production dependencies only). Build and run:

```bash
docker build -t private-room-bot .

# Register the /setup slash command once (one-off container):
docker run --rm --env-file .env private-room-bot node dist/deploy-commands.js

# Run the bot, persisting state to a named volume so /setup config and active
# rooms survive restarts:
docker run -d --name private-room-bot --restart unless-stopped \
  --env-file .env \
  -v private-room-bot-data:/app/data \
  private-room-bot
```

Pass secrets via `--env-file .env` (or `-e DISCORD_TOKEN=… -e CLIENT_ID=…`).
The bot makes only outbound connections, so no ports need publishing. This
image also works on container hosts like Fly.io or Railway — mount a
persistent volume at `/app/data`.

---

## Troubleshooting

### The bot cannot create or delete roles

**Cause:** The bot's role is not high enough in the server role hierarchy.

**Fix:** Go to **Server Settings → Roles** and drag the bot's role above any roles you want it to manage. See the [Role Hierarchy](#️-role-hierarchy-critical) section above.

### Slash commands are not appearing in Discord

**Cause:** Global slash command registration can take up to 1 hour to propagate to all Discord servers.

**Fix:** Set `GUILD_ID` in your `.env` file to your test server's ID. Guild-scoped commands register instantly. Remove `GUILD_ID` when deploying to production.

### "Server Members Intent" error on startup

**Cause:** The privileged Server Members Intent is not enabled in the Developer Portal.

**Fix:** Go to [discord.com/developers/applications](https://discord.com/developers/applications) → your app → **Bot** tab → **Privileged Gateway Intents** → enable **Server Members Intent**.

### Rooms are not being deleted after everyone leaves

**Cause:** The bot may have lost track of a room (e.g. it restarted mid-session), or the Manage Channels permission is missing.

**Fix:** The periodic orphan sweep (every 60 s by default) will catch and clean up stale rooms. Ensure the bot has **Manage Channels** and **Manage Roles** permissions in the relevant category.
