# Memory Backup Skill for OpenClaw

Google Drive backup for memory-chain with end-to-end encryption.

## Installation

This skill requires `googleapis` and `cron` packages:

```bash
npm install googleapis cron
```

## Features

### End-to-End Encryption
All backups are encrypted with AES-256-GCM before uploading to Google Drive:
- Password-based encryption using scrypt key derivation
- Only you can decrypt your backups
- Google has no access to your data

### OAuth2 Authentication
Secure Google account linking:
- Uses Google's OAuth2 consent flow
- Only requests `drive.file` scope (access only to files created by this app)
- Refresh tokens are encrypted at rest

### Scheduled Backups
Automatic backups via cron:
- Default: Daily at 3 AM
- Configurable via Telegram commands
- Retention policy for automatic cleanup

### Incremental
Smart backup logic:
- Detects when chain has changed
- Skips backup if no changes
- Efficient storage usage

## Commands

| Command | Description |
|---------|-------------|
| `/memory backup setup` | Start OAuth2 authorization |
| `/memory backup now` | Create immediate backup |
| `/memory backup status` | Show status and schedule |
| `/memory backup list` | List available backups |
| `/memory backup restore [date]` | Restore from backup |
| `/memory backup schedule <cron>` | Set automatic schedule |
| `/memory backup schedule stop` | Stop automatic backups |
| `/memory backup help` | Show help |

## Setup Flow

1. **Connect Google Drive**
   ```
   /memory backup setup
   ```
   - Click the authorization link
   - Sign in with Google
   - Copy the code back to Telegram

2. **Set Backup Password**
   - You'll be prompted to set a password
   - This password encrypts all backups
   - Keep it safe - you need it to restore!

3. **Create First Backup**
   ```
   /memory backup now
   ```

4. **Set Schedule (Optional)**
   ```
   /memory backup schedule 0 3 * * *
   ```

## Configuration

```json
{
  "skills": {
    "memory-backup": {
      "dataDir": "~/.openclaw/memory-chain",
      "configDir": "~/.openclaw/memory-backup",
      "folderName": "OpenClaw Backups",
      "defaultSchedule": "0 3 * * *",
      "retention": 30
    }
  }
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dataDir` | string | `~/.openclaw/memory-chain` | Memory chain location |
| `configDir` | string | `~/.openclaw/memory-backup` | Backup config location |
| `folderName` | string | `OpenClaw Backups` | Google Drive folder |
| `defaultSchedule` | string | `0 3 * * *` | Default cron schedule |
| `retention` | number | 30 | Backups to keep |

## File Storage

```
~/.openclaw/memory-backup/
├── gdrive-token.json   # Encrypted OAuth2 tokens
└── schedule.json       # Schedule configuration
```

## Backup Format

Backups are tar.gz archives encrypted with AES-256-GCM:

```
memory-chain-backup-{agent}-{timestamp}.enc

Contents (before encryption):
├── config.json       # Agent configuration
├── chain.jsonl       # Hash chain
├── agent.pub         # Public key (not private!)
├── content/          # Content files
│   └── <hash>
└── anchors/          # OTS proofs
    └── entry-*.ots
```

## Security Notes

1. **Private Key Not Backed Up**
   The `agent.key` file is intentionally excluded from backups. You should:
   - Back up your private key separately
   - Keep it in a secure location
   - Never share it

2. **Password Security**
   - Use a strong, unique password
   - The password is not stored (you must remember it)
   - Wrong password = cannot restore

3. **Google Drive Access**
   - We only request `drive.file` scope
   - Can only access files created by this app
   - Cannot read other files in your Drive

4. **Private Chat Only**
   - Setup and restore only work in private chats
   - Prevents accidental password exposure in groups

## Cron Expression Reference

| Expression | Description |
|------------|-------------|
| `0 3 * * *` | Daily at 3:00 AM |
| `0 0 * * 0` | Weekly on Sunday midnight |
| `0 */6 * * *` | Every 6 hours |
| `0 0 1 * *` | Monthly on the 1st |
| `30 4 * * 1-5` | Weekdays at 4:30 AM |

Format: `minute hour day-of-month month day-of-week`

## Troubleshooting

### "Not authorized"
Run `/memory backup setup` to connect Google Drive.

### "Password not set"
Enter your backup password when prompted. The password is session-based and needs to be entered once after bot restart.

### "Backup failed"
- Check Google Drive storage quota
- Verify internet connectivity
- Check if memory chain exists

### "Restore failed: invalid password"
The password you entered doesn't match the one used for backup. Try again with the correct password.

## License

MIT
