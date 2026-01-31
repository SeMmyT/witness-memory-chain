---
name: memory-backup
version: 0.1.0
description: Google Drive backup for memory-chain
author: openclaw
tags: [memory, backup, google-drive, encryption]
requires:
  - node: ">=20"
  - skill: memory-chain
dependencies:
  googleapis: "^144.0.0"
  cron: "^3.1.0"
commands:
  backup:
    script: src/commands.ts
    description: Manage backups via Telegram
---

# Memory Backup Skill for OpenClaw

Automated Google Drive backup for memory-chain with end-to-end encryption.

## Features

- **OAuth2 Authentication**: Secure Google account linking via Telegram
- **End-to-End Encryption**: Backups encrypted with AES-256-GCM before upload
- **Scheduled Backups**: Configurable cron-based automatic backups
- **Incremental**: Only backs up when chain has changed
- **Retention Policy**: Configurable backup history retention

## Commands

### /memory backup setup
Start Google Drive OAuth2 authorization flow.

### /memory backup now
Trigger an immediate backup.

### /memory backup status
Show last backup time, size, and next scheduled backup.

### /memory backup restore [date]
Download and restore from a backup. Use `latest` for most recent.

### /memory backup schedule <cron>
Set backup schedule (e.g., `0 3 * * *` for daily at 3 AM).

### /memory backup list
List available backups in Google Drive.

## Setup

1. Enable the skill in OpenClaw config
2. Run `/memory backup setup` in Telegram
3. Click the authorization link
4. Authorize the app in your browser
5. Copy the code back to Telegram
6. Set a backup password when prompted

## Configuration

```json
{
  "skills": {
    "memory-backup": {
      "schedule": "0 3 * * *",
      "retention": 30,
      "encryptionMode": "separate",
      "folderName": "OpenClaw Backups"
    }
  }
}
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `schedule` | Cron expression for automatic backups | `0 3 * * *` (3 AM daily) |
| `retention` | Days to keep backups | 30 |
| `encryptionMode` | `separate` (unique password) or `chain-key` (use agent key) | `separate` |
| `folderName` | Google Drive folder name | `OpenClaw Backups` |

## Security

- Backup password is required for restore (never stored in plaintext)
- All data is encrypted locally before upload to Google Drive
- OAuth2 refresh token is encrypted at rest
- Only you have access to your backups (stored in your Drive)

## Architecture

```
Memory Chain → Tar Archive → AES-256-GCM Encrypt → Upload to Drive
                   ↑                                      ↓
               chain.jsonl                     memory-chain-backup-*.enc
               content/*
               anchors/*
```
