# Deploying on Google Cloud (free `e2-micro` VM)

This bot needs an **always-on process** with a **persistent disk** (it keeps a
Discord gateway connection open and stores `/setup` config + active rooms as
JSON in `data/`). Compute Engine's Always-Free `e2-micro` VM fits perfectly.

> **Do NOT use Cloud Run / Cloud Functions / App Engine** — they are
> request-driven and scale to zero, which drops the gateway connection.

## 1. Create the VM

Compute Engine → **Create instance**. The Always-Free tier requires:

- **Machine type:** `e2-micro`
- **Region:** one of `us-west1`, `us-central1`, or `us-east1` (Always-Free only applies here)
- **Boot disk:** Debian 12, **standard persistent disk ≤ 30 GB** (free limit)
- Leave the rest default. No public HTTP/HTTPS firewall rules are needed — the
  bot makes only **outbound** connections to Discord.

Or via the CLI:

```bash
gcloud compute instances create private-room-bot \
  --machine-type=e2-micro \
  --zone=us-central1-a \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard
```

## 2. SSH in and install Node 22

Node 22 (LTS) or newer is required — `@discordjs/voice` (DAVE/E2EE voice) needs `node >= 22.12`.

Use the **SSH** button in the console (or `gcloud compute ssh private-room-bot --zone=us-central1-a`), then:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # should print v22.x
```

Already on an older Node (e.g. v20)? Run the two commands above to upgrade in place, then from the repo: `rm -rf node_modules && ./update.sh`.

## 3. Get the code onto the VM

If the GitHub repo is private, the easiest path is a Personal Access Token:

```bash
git clone https://github.com/danyalmeidakairouz/private-room-bot.git
# (paste a GitHub PAT as the password when prompted, or scp the folder up)
cd private-room-bot
```

## 4. Configure and build

```bash
npm install
cp .env.example .env
nano .env        # fill DISCORD_TOKEN and CLIENT_ID (GUILD_ID optional)
npm run build    # compiles to dist/
npm run deploy   # registers the /setup slash command
```

## 5. Run it 24/7 with systemd

```bash
# Edit the marked lines (User / WorkingDirectory) to match your VM:
nano deploy/private-room-bot.service     # set User=$(whoami), path to this folder
#   ExecStart path: confirm with `which node` (usually /usr/bin/node)

sudo cp deploy/private-room-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now private-room-bot
```

The service auto-starts on boot and auto-restarts on crash.

## 6. Operate

```bash
systemctl status private-room-bot        # is it running?
journalctl -u private-room-bot -f        # live logs
sudo systemctl restart private-room-bot  # after pulling new code + npm run build
```

## Updating later

```bash
cd ~/private-room-bot
git pull
npm install
npm run build
sudo systemctl restart private-room-bot
```

## Notes

- The VM's disk is persistent, so `data/guild-config.json` and
  `data/temp-rooms.json` survive reboots — you won't need to re-run `/setup`.
- `e2-micro` has limited RAM (~1 GB); this bot is tiny and runs comfortably.
- Keep the VM in an Always-Free region or you may be billed.
