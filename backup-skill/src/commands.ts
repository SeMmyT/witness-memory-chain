/**
 * Backup Command Handler
 *
 * Handles /memory backup commands for Google Drive backup operations.
 * Called by OpenClaw gateway when user sends /memory backup in Telegram.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { createDriveClient, GoogleDriveClient } from './gdrive.js';
import {
  backupToDrive,
  restoreFromDrive,
  getBackupStatus,
  BackupStatus,
} from './backup.js';
import {
  startScheduledBackups,
  stopScheduledBackups,
  getScheduleInfo,
  updateSchedule,
  triggerImmediateBackup,
  validateCronExpression,
  describeCronExpression,
  getNextRunTime,
} from './schedule.js';
import { validatePassword } from './encrypt.js';

/** Configuration for the backup command */
export interface BackupCommandConfig {
  /** Data directory for memory chain */
  dataDir?: string;
  /** Config directory for backup state */
  configDir?: string;
  /** Default backup schedule */
  defaultSchedule?: string;
  /** Backup retention count */
  retention?: number;
  /** Google Drive folder name */
  folderName?: string;
}

/** Context provided by OpenClaw gateway */
export interface CommandContext {
  /** The command arguments (text after /memory backup) */
  args: string;
  /** User ID */
  userId: string;
  /** Chat ID */
  chatId: string;
  /** Chat type */
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  /** Skill configuration */
  config?: BackupCommandConfig;
  /** Session state (for multi-step flows) */
  state?: BackupState;
}

/** State for multi-step flows (OAuth, password setup) */
export interface BackupState {
  /** Current flow step */
  step?: 'awaiting_code' | 'awaiting_password' | 'awaiting_restore_password';
  /** OAuth auth URL (for setup flow) */
  authUrl?: string;
  /** File ID for restore */
  restoreFileId?: string;
  /** Stored password hash (for verification) */
  passwordSet?: boolean;
}

/** Result of command execution */
export interface CommandResult {
  /** Response text to send back */
  response: string;
  /** Whether this is an error response */
  error?: boolean;
  /** Updated state (for multi-step flows) */
  state?: BackupState;
  /** Whether to clear state */
  clearState?: boolean;
}

// In-memory password storage (per user)
// In production, this should be encrypted and persisted
const userPasswords = new Map<string, string>();

/**
 * Parse command arguments
 */
function parseArgs(args: string): { subcommand: string; rest: string } {
  const trimmed = args.trim();
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) {
    return { subcommand: trimmed.toLowerCase(), rest: '' };
  }
  return {
    subcommand: trimmed.slice(0, spaceIndex).toLowerCase(),
    rest: trimmed.slice(spaceIndex + 1).trim(),
  };
}

/**
 * Handle /memory backup setup
 */
async function handleSetup(
  context: CommandContext,
  configDir: string
): Promise<CommandResult> {
  // Only allow in private chats
  if (context.chatType !== 'private') {
    return {
      response: 'Backup setup must be done in a private chat for security.',
      error: true,
    };
  }

  // Check if awaiting code
  if (context.state?.step === 'awaiting_code') {
    // User is sending the auth code
    const code = context.args.trim();
    if (!code) {
      return {
        response: 'Please send the authorization code from Google.',
        state: context.state,
      };
    }

    const client = createDriveClient(configDir);
    const success = await client.exchangeCode(code);

    if (success) {
      return {
        response:
          'Google Drive connected successfully!\n\n' +
          'Now set a backup password. This password will encrypt your backups.\n\n' +
          'Send your password (at least 8 characters):',
        state: { step: 'awaiting_password' },
      };
    } else {
      return {
        response: 'Failed to authorize. Please try setup again.',
        error: true,
        clearState: true,
      };
    }
  }

  // Check if awaiting password
  if (context.state?.step === 'awaiting_password') {
    const password = context.args.trim();
    const validationError = validatePassword(password);

    if (validationError) {
      return {
        response: `Invalid password: ${validationError}\n\nPlease try again:`,
        state: context.state,
      };
    }

    // Store password (in memory for this session)
    userPasswords.set(context.userId, password);

    return {
      response:
        'Backup password set!\n\n' +
        'Setup complete. You can now use:\n' +
        '- /memory backup now - Create a backup\n' +
        '- /memory backup schedule <cron> - Set automatic backups\n' +
        '- /memory backup status - Check backup status',
      clearState: true,
    };
  }

  // Start OAuth flow
  const client = createDriveClient(configDir);
  const authUrl = await client.getAuthUrl();

  return {
    response:
      'To connect Google Drive for backups:\n\n' +
      '1. Click this link to authorize:\n' +
      `${authUrl}\n\n` +
      '2. Sign in with your Google account\n' +
      '3. Copy the authorization code\n' +
      '4. Send the code back here',
    state: { step: 'awaiting_code', authUrl },
  };
}

/**
 * Handle /memory backup now
 */
async function handleNow(
  context: CommandContext,
  dataDir: string,
  configDir: string,
  folderName: string
): Promise<CommandResult> {
  // Check if authorized
  const client = createDriveClient(configDir);
  if (!(await client.isAuthorized())) {
    return {
      response: 'Google Drive not connected. Run /memory backup setup first.',
      error: true,
    };
  }

  // Check for password
  const password = userPasswords.get(context.userId);
  if (!password) {
    return {
      response:
        'Backup password not set. Please set your password:\n\n' +
        'Send your backup password (at least 8 characters):',
      state: { step: 'awaiting_password' },
    };
  }

  // Create backup
  const result = await backupToDrive(dataDir, password, client, folderName);

  if (result.success) {
    const sizeKB = result.size ? (result.size / 1024).toFixed(1) : '?';
    return {
      response:
        `Backup created successfully!\n\n` +
        `File: ${result.filename}\n` +
        `Size: ${sizeKB} KB\n` +
        `Entries: ${result.entryCount ?? '?'}`,
    };
  } else {
    return {
      response: `Backup failed: ${result.error}`,
      error: true,
    };
  }
}

/**
 * Handle /memory backup status
 */
async function handleStatus(
  configDir: string,
  folderName: string
): Promise<CommandResult> {
  const client = createDriveClient(configDir);

  if (!(await client.isAuthorized())) {
    return {
      response: 'Google Drive not connected. Run /memory backup setup first.',
    };
  }

  const status = await getBackupStatus(client, folderName);
  const scheduleInfo = getScheduleInfo();

  const lines = [
    'Backup Status',
    '',
    `Total backups: ${status.backupCount}`,
  ];

  if (status.lastBackup) {
    lines.push(`Last backup: ${new Date(status.lastBackup).toLocaleString()}`);
  }

  if (status.lastBackupSize) {
    lines.push(`Last backup size: ${(status.lastBackupSize / 1024).toFixed(1)} KB`);
  }

  if (status.totalStorageUsed > 0) {
    lines.push(`Total storage: ${(status.totalStorageUsed / 1024 / 1024).toFixed(2)} MB`);
  }

  lines.push('');

  if (scheduleInfo.isScheduled) {
    lines.push(`Schedule: ${scheduleInfo.description}`);
    if (scheduleInfo.nextRun) {
      lines.push(`Next backup: ${new Date(scheduleInfo.nextRun).toLocaleString()}`);
    }
  } else {
    lines.push('Schedule: Not configured');
    lines.push('Use /memory backup schedule <cron> to set up automatic backups');
  }

  return {
    response: lines.join('\n'),
  };
}

/**
 * Handle /memory backup list
 */
async function handleList(
  configDir: string,
  folderName: string
): Promise<CommandResult> {
  const client = createDriveClient(configDir);

  if (!(await client.isAuthorized())) {
    return {
      response: 'Google Drive not connected. Run /memory backup setup first.',
      error: true,
    };
  }

  try {
    const folderId = await client.findOrCreateFolder(folderName);
    const backups = await client.listBackups(folderId);

    if (backups.length === 0) {
      return {
        response: 'No backups found. Use /memory backup now to create one.',
      };
    }

    const lines = [`Found ${backups.length} backups:\n`];

    for (const backup of backups.slice(0, 10)) {
      const date = backup.modifiedTime
        ? new Date(backup.modifiedTime).toLocaleDateString()
        : 'Unknown';
      const size = backup.size
        ? `${(parseInt(backup.size, 10) / 1024).toFixed(1)} KB`
        : '?';
      lines.push(`- ${backup.name} (${date}, ${size})`);
    }

    if (backups.length > 10) {
      lines.push(`... and ${backups.length - 10} more`);
    }

    return {
      response: lines.join('\n'),
    };
  } catch (error) {
    return {
      response: `Error listing backups: ${error instanceof Error ? error.message : String(error)}`,
      error: true,
    };
  }
}

/**
 * Handle /memory backup restore [date]
 */
async function handleRestore(
  context: CommandContext,
  dateArg: string,
  dataDir: string,
  configDir: string,
  folderName: string
): Promise<CommandResult> {
  // Only allow in private chats
  if (context.chatType !== 'private') {
    return {
      response: 'Restore must be done in a private chat for security.',
      error: true,
    };
  }

  const client = createDriveClient(configDir);

  if (!(await client.isAuthorized())) {
    return {
      response: 'Google Drive not connected. Run /memory backup setup first.',
      error: true,
    };
  }

  // Check if awaiting restore password
  if (context.state?.step === 'awaiting_restore_password') {
    const password = context.args.trim();
    const fileId = context.state.restoreFileId;

    if (!fileId) {
      return {
        response: 'Restore state lost. Please try again.',
        error: true,
        clearState: true,
      };
    }

    const result = await restoreFromDrive(fileId, password, dataDir, client);

    if (result.success) {
      return {
        response:
          `Restore completed successfully!\n\n` +
          `Entries restored: ${result.entryCount ?? '?'}\n` +
          `Content files: ${result.contentFiles ?? '?'}`,
        clearState: true,
      };
    } else {
      return {
        response: `Restore failed: ${result.error}\n\nPlease check your password and try again.`,
        state: context.state,
      };
    }
  }

  // Find the backup to restore
  try {
    const folderId = await client.findOrCreateFolder(folderName);
    const backups = await client.listBackups(folderId);

    if (backups.length === 0) {
      return {
        response: 'No backups found to restore.',
        error: true,
      };
    }

    let targetBackup;
    if (!dateArg || dateArg === 'latest') {
      targetBackup = backups[0]; // Most recent
    } else {
      // Try to find by date
      targetBackup = backups.find((b) => b.name?.includes(dateArg) || b.modifiedTime?.includes(dateArg));
    }

    if (!targetBackup || !targetBackup.id) {
      return {
        response: `Backup not found. Use /memory backup list to see available backups.`,
        error: true,
      };
    }

    return {
      response:
        `Ready to restore: ${targetBackup.name}\n\n` +
        `WARNING: This will overwrite your current memory chain!\n\n` +
        `Send your backup password to confirm:`,
      state: {
        step: 'awaiting_restore_password',
        restoreFileId: targetBackup.id,
      },
    };
  } catch (error) {
    return {
      response: `Error: ${error instanceof Error ? error.message : String(error)}`,
      error: true,
    };
  }
}

/**
 * Handle /memory backup schedule <cron>
 */
async function handleSchedule(
  context: CommandContext,
  cronExpression: string,
  dataDir: string,
  configDir: string,
  folderName: string,
  retention: number
): Promise<CommandResult> {
  if (!cronExpression) {
    const info = getScheduleInfo();
    if (info.isScheduled) {
      return {
        response:
          `Current schedule: ${info.description}\n` +
          `Next backup: ${info.nextRun ? new Date(info.nextRun).toLocaleString() : 'Unknown'}\n\n` +
          `To change: /memory backup schedule <cron>\n` +
          `To stop: /memory backup schedule stop`,
      };
    } else {
      return {
        response:
          'No backup schedule configured.\n\n' +
          'Examples:\n' +
          '- /memory backup schedule 0 3 * * * (daily at 3 AM)\n' +
          '- /memory backup schedule 0 0 * * 0 (weekly on Sunday)\n' +
          '- /memory backup schedule 0 */6 * * * (every 6 hours)',
      };
    }
  }

  if (cronExpression === 'stop') {
    stopScheduledBackups();
    return {
      response: 'Scheduled backups stopped.',
    };
  }

  const validationError = validateCronExpression(cronExpression);
  if (validationError) {
    return {
      response: `Invalid cron expression: ${validationError}`,
      error: true,
    };
  }

  // Check if we have a password
  const password = userPasswords.get(context.userId);
  if (!password) {
    return {
      response:
        'Please set your backup password first:\n\n' +
        'Send your backup password (at least 8 characters):',
      state: { step: 'awaiting_password' },
    };
  }

  const client = createDriveClient(configDir);
  if (!(await client.isAuthorized())) {
    return {
      response: 'Google Drive not connected. Run /memory backup setup first.',
      error: true,
    };
  }

  startScheduledBackups(
    {
      cronExpression,
      dataDir,
      password,
      folderName,
      retention,
      onComplete: (success, error) => {
        // In a real implementation, this would send a notification
        if (!success) {
          console.error(`[memory-backup] Scheduled backup failed: ${error}`);
        }
      },
    },
    client
  );

  const description = describeCronExpression(cronExpression);
  const nextRun = getNextRunTime(cronExpression);

  return {
    response:
      `Backup schedule set: ${description}\n\n` +
      `Next backup: ${nextRun ? new Date(nextRun).toLocaleString() : 'Unknown'}\n` +
      `Retention: ${retention} backups`,
  };
}

/**
 * Handle /memory backup help
 */
function handleHelp(): CommandResult {
  const help = `Memory Backup Commands:

/memory backup setup
  Connect Google Drive and set password

/memory backup now
  Create an immediate backup

/memory backup status
  Show backup status and schedule

/memory backup list
  List available backups

/memory backup restore [date|latest]
  Restore from a backup

/memory backup schedule <cron>
  Set automatic backup schedule
  Examples:
  - 0 3 * * * (daily at 3 AM)
  - 0 0 * * 0 (weekly on Sunday)

/memory backup schedule stop
  Stop automatic backups

/memory backup help
  Show this help message`;

  return {
    response: help,
  };
}

/**
 * Main command handler
 */
export async function backup(context: CommandContext): Promise<CommandResult> {
  const config = context.config ?? {};
  const dataDir = config.dataDir ?? join(homedir(), '.openclaw', 'memory-chain');
  const configDir = config.configDir ?? join(homedir(), '.openclaw', 'memory-backup');
  const folderName = config.folderName ?? 'OpenClaw Backups';
  const retention = config.retention ?? 30;

  // Check if we're in a multi-step flow
  if (context.state?.step) {
    switch (context.state.step) {
      case 'awaiting_code':
        return handleSetup(context, configDir);
      case 'awaiting_password':
        // This could be for setup or schedule
        const password = context.args.trim();
        const validationError = validatePassword(password);
        if (validationError) {
          return {
            response: `Invalid password: ${validationError}\n\nPlease try again:`,
            state: context.state,
          };
        }
        userPasswords.set(context.userId, password);
        return {
          response: 'Password set! You can now use backup commands.',
          clearState: true,
        };
      case 'awaiting_restore_password':
        return handleRestore(context, '', dataDir, configDir, folderName);
    }
  }

  const { subcommand, rest } = parseArgs(context.args);

  switch (subcommand) {
    case 'setup':
      return handleSetup(context, configDir);

    case 'now':
      return handleNow(context, dataDir, configDir, folderName);

    case 'status':
      return handleStatus(configDir, folderName);

    case 'list':
      return handleList(configDir, folderName);

    case 'restore':
      return handleRestore(context, rest, dataDir, configDir, folderName);

    case 'schedule':
      return handleSchedule(context, rest, dataDir, configDir, folderName, retention);

    case 'help':
    case '':
      return handleHelp();

    default:
      return {
        response: `Unknown subcommand: ${subcommand}\n\nUse /memory backup help for available commands.`,
        error: true,
      };
  }
}

// Export as default for OpenClaw command loader
export default backup;
