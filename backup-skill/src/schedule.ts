/**
 * Backup Scheduling
 *
 * Provides cron-based automatic backup scheduling.
 */

import { CronJob } from 'cron';
import { backupToDrive } from './backup.js';
import { GoogleDriveClient } from './gdrive.js';

/** Schedule configuration */
export interface ScheduleConfig {
  /** Cron expression (default: '0 3 * * *' for 3 AM daily) */
  cronExpression: string;
  /** Timezone (default: local) */
  timezone?: string;
  /** Memory chain data directory */
  dataDir: string;
  /** Backup password */
  password: string;
  /** Google Drive folder name */
  folderName: string;
  /** Number of backups to retain */
  retention: number;
  /** Callback on backup completion */
  onComplete?: (success: boolean, error?: string) => void;
}

/** Active scheduler instance */
let activeJob: CronJob | null = null;
let activeConfig: ScheduleConfig | null = null;
let activeDriveClient: GoogleDriveClient | null = null;

/**
 * Parse and validate cron expression
 *
 * @param expression - Cron expression to validate
 * @returns Error message if invalid, null if valid
 */
export function validateCronExpression(expression: string): string | null {
  try {
    // Try to create a CronJob to validate the expression
    const job = new CronJob(expression, () => {}, null, false);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid cron expression';
  }
}

/**
 * Get human-readable description of cron schedule
 *
 * @param expression - Cron expression
 * @returns Human-readable description
 */
export function describeCronExpression(expression: string): string {
  const parts = expression.trim().split(/\s+/);

  if (parts.length !== 5) {
    return expression;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Common patterns
  if (minute === '0' && hour === '3' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Daily at 3:00 AM';
  }
  if (minute === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${hour}:00`;
  }
  if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '0') {
    return 'Weekly on Sunday at midnight';
  }
  if (minute === '0' && hour === '0' && dayOfMonth === '1' && month === '*' && dayOfWeek === '*') {
    return 'Monthly on the 1st at midnight';
  }

  // Generic description
  return `At ${minute} minutes past ${hour} hours`;
}

/**
 * Get next scheduled run time
 *
 * @param expression - Cron expression
 * @returns Next run time as ISO string
 */
export function getNextRunTime(expression: string): string | null {
  try {
    const job = new CronJob(expression, () => {}, null, false);
    const next = job.nextDate();
    return next.toISO();
  } catch {
    return null;
  }
}

/**
 * Start scheduled backups
 *
 * @param config - Schedule configuration
 * @param driveClient - Google Drive client
 */
export function startScheduledBackups(
  config: ScheduleConfig,
  driveClient: GoogleDriveClient
): void {
  // Stop any existing schedule
  stopScheduledBackups();

  activeConfig = config;
  activeDriveClient = driveClient;

  activeJob = new CronJob(
    config.cronExpression,
    async () => {
      console.log(`[memory-backup] Starting scheduled backup at ${new Date().toISOString()}`);

      try {
        const result = await backupToDrive(
          config.dataDir,
          config.password,
          driveClient,
          config.folderName
        );

        if (result.success) {
          console.log(`[memory-backup] Backup completed: ${result.filename}`);

          // Prune old backups
          if (config.retention > 0) {
            const folderId = await driveClient.findOrCreateFolder(config.folderName);
            const deleted = await driveClient.pruneOldBackups(folderId, config.retention);
            if (deleted > 0) {
              console.log(`[memory-backup] Pruned ${deleted} old backups`);
            }
          }

          config.onComplete?.(true);
        } else {
          console.error(`[memory-backup] Backup failed: ${result.error}`);
          config.onComplete?.(false, result.error);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[memory-backup] Backup error: ${errorMsg}`);
        config.onComplete?.(false, errorMsg);
      }
    },
    null, // onComplete
    true, // start immediately
    config.timezone // timezone
  );

  console.log(
    `[memory-backup] Scheduled backups: ${describeCronExpression(config.cronExpression)}`
  );
  console.log(`[memory-backup] Next backup: ${getNextRunTime(config.cronExpression)}`);
}

/**
 * Stop scheduled backups
 */
export function stopScheduledBackups(): void {
  if (activeJob) {
    activeJob.stop();
    activeJob = null;
  }
  activeConfig = null;
  activeDriveClient = null;
}

/**
 * Check if backups are scheduled
 */
export function isScheduled(): boolean {
  return activeJob !== null && activeJob.running;
}

/**
 * Get current schedule information
 */
export interface ScheduleInfo {
  /** Whether backups are scheduled */
  isScheduled: boolean;
  /** Current cron expression (if scheduled) */
  cronExpression?: string;
  /** Human-readable description */
  description?: string;
  /** Next scheduled run time */
  nextRun?: string;
}

export function getScheduleInfo(): ScheduleInfo {
  if (!activeJob || !activeConfig) {
    return { isScheduled: false };
  }

  return {
    isScheduled: activeJob.running,
    cronExpression: activeConfig.cronExpression,
    description: describeCronExpression(activeConfig.cronExpression),
    nextRun: getNextRunTime(activeConfig.cronExpression) ?? undefined,
  };
}

/**
 * Update schedule without losing state
 *
 * @param newCronExpression - New cron expression
 */
export function updateSchedule(newCronExpression: string): boolean {
  if (!activeConfig || !activeDriveClient) {
    return false;
  }

  const error = validateCronExpression(newCronExpression);
  if (error) {
    return false;
  }

  activeConfig.cronExpression = newCronExpression;
  startScheduledBackups(activeConfig, activeDriveClient);
  return true;
}

/**
 * Trigger an immediate backup (outside schedule)
 */
export async function triggerImmediateBackup(): Promise<{ success: boolean; error?: string }> {
  if (!activeConfig || !activeDriveClient) {
    return { success: false, error: 'Backups not configured' };
  }

  try {
    const result = await backupToDrive(
      activeConfig.dataDir,
      activeConfig.password,
      activeDriveClient,
      activeConfig.folderName
    );

    if (result.success) {
      return { success: true };
    } else {
      return { success: false, error: result.error };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
