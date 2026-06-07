# Private Room Bot

A discord.js v14 bot that turns a "Join to Create" lobby voice channel into temporary private voice rooms. When a member joins the lobby, the bot creates a new voice channel with a randomly generated name, a matching temporary role placed just below the admin role (and above @everyone), moves the creator into the room, assigns them the role, and generates an invite link posted in the room and sent via DM. When everyone leaves, the room and its temporary role are automatically deleted.

---

## Features

- **One-command setup** — `/setup` creates the lobby channel and stores your guild configuration.
- **Auto-generated room names** — random `Adjective-Noun-XXX` format (e.g. `Brave-Otter-7K2`).
- **Per-room temporary role** — allows only the invited members to see and join the room; automatically cleaned up when the room empties.
- **Invite link generation** — 24-hour invite posted in the channel and DMed to the creator.
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
| Move Members | 16,777,216 |
| **Total** | **286,262,289** |

Calculation: `1024 + 1 + 16 + 268435456 + 1048576 + 16777216 = 286,262,289`

Use this invite URL template (replace `YOUR_CLIENT_ID`):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=286262289&scope=bot+applications.commands
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
| `admin_role` | Role to whitelist as room admin (can manage all rooms) | None |
| `category` | Name of the category to create rooms under | `Private Rooms` |

This creates the **➕ Join to Create** lobby channel under the specified (or new) category and stores your guild configuration.

### Creating a Room

1. Any member joins the **➕ Join to Create** lobby.
2. The bot instantly:
   - Creates a new private voice channel (e.g. `Brave-Otter-7K2`).
   - Creates a matching temporary role and places it just below the admin role.
   - Moves the member into the new channel.
   - Assigns the temporary role to the member.
   - Posts a 24-hour invite link in the channel and DMs it to the member.
3. The member can share the invite link or drag friends into the channel directly.

### Room Deletion

When the last member leaves a temporary room, the bot waits 5 seconds (grace period) then deletes the voice channel and its temporary role. If someone rejoins within those 5 seconds, deletion is cancelled.

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
    voiceStateUpdate.ts   # handles join/leave logic for lobby and temp rooms
    interactionCreate.ts  # routes slash command interactions
  services/
    roomManager.ts        # core orchestration — create/delete rooms and roles
  store/
    jsonStore.ts          # generic persistent JSON file store
    guildConfigStore.ts   # per-guild setup configuration (lobby channel, admin role)
    tempRoomStore.ts      # tracks active temporary rooms and their roles
  util/
    nameGenerator.ts      # generates random Adjective-Noun-XXX room names
```

---

## Configuration Tunables

The `DEFAULTS` object in `src/constants.ts` controls the bot's built-in timing and naming:

| Key | Default | Description |
|---|---|---|
| `graceMs` | `5000` | Milliseconds to wait before deleting an empty room |
| `inviteMaxAgeSec` | `86400` | Invite lifetime in seconds (24 hours) |
| `sweepIntervalMs` | `60000` | How often to run the orphan sweep (60 seconds) |
| `lobbyChannelName` | `➕ Join to Create` | Default name for the lobby channel |
| `categoryName` | `Private Rooms` | Default name for the voice category |

To change these, edit the values in `src/constants.ts` before building.

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
