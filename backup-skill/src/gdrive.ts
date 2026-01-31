/**
 * Google Drive API Wrapper
 *
 * Handles OAuth2 authentication and file operations with Google Drive.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

// Types for Google APIs (we'll use dynamic import to avoid bundling issues)
interface OAuth2Client {
  generateAuthUrl(options: { access_type: string; scope: string[] }): string;
  getToken(code: string): Promise<{ tokens: Credentials }>;
  setCredentials(credentials: Credentials): void;
  credentials: Credentials;
}

interface Credentials {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  token_type?: string | null;
}

interface DriveFile {
  id?: string | null;
  name?: string | null;
  size?: string | null;
  modifiedTime?: string | null;
  mimeType?: string | null;
}

/** OAuth2 configuration */
export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Default OAuth2 credentials for OpenClaw (public app) */
const DEFAULT_OAUTH_CONFIG: OAuth2Config = {
  // These are public OAuth2 credentials for the OpenClaw app
  // Users authorize through Google's consent screen
  clientId: process.env.GDRIVE_CLIENT_ID || '',
  clientSecret: process.env.GDRIVE_CLIENT_SECRET || '',
  redirectUri: 'urn:ietf:wg:oauth:2.0:oob', // Out-of-band for CLI
};

/** Scopes required for backup operations */
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file', // Only access files created by this app
];

/** Token storage file name */
const TOKEN_FILE = 'gdrive-token.json';

/** Encrypted token file format */
interface StoredToken {
  /** Encrypted credentials (JSON string) */
  encrypted: string;
  /** Whether encryption is used */
  isEncrypted: boolean;
}

/**
 * Google Drive client for backup operations
 */
export class GoogleDriveClient {
  private oauth2Client: OAuth2Client | null = null;
  private drive: unknown | null = null;
  private configDir: string;
  private encryptionKey: string | null = null;

  constructor(configDir: string, encryptionKey?: string) {
    this.configDir = configDir;
    this.encryptionKey = encryptionKey ?? null;
  }

  /**
   * Initialize the OAuth2 client
   */
  private async initClient(config?: OAuth2Config): Promise<OAuth2Client> {
    const { google } = await import('googleapis');
    const oauthConfig = config ?? DEFAULT_OAUTH_CONFIG;

    if (!oauthConfig.clientId || !oauthConfig.clientSecret) {
      throw new Error(
        'Google Drive credentials not configured. Set GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET environment variables.'
      );
    }

    this.oauth2Client = new google.auth.OAuth2(
      oauthConfig.clientId,
      oauthConfig.clientSecret,
      oauthConfig.redirectUri
    );

    return this.oauth2Client;
  }

  /**
   * Generate authorization URL for OAuth2 flow
   *
   * @returns URL to redirect user to for authorization
   */
  async getAuthUrl(config?: OAuth2Config): Promise<string> {
    const client = await this.initClient(config);
    return client.generateAuthUrl({
      access_type: 'offline', // Request refresh token
      scope: SCOPES,
    });
  }

  /**
   * Exchange authorization code for tokens
   *
   * @param code - Authorization code from Google
   * @returns Whether tokens were successfully obtained
   */
  async exchangeCode(code: string, config?: OAuth2Config): Promise<boolean> {
    const client = await this.initClient(config);

    try {
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      // Save tokens
      await this.saveTokens(tokens);
      return true;
    } catch (error) {
      console.error('Failed to exchange code:', error);
      return false;
    }
  }

  /**
   * Save tokens to file (optionally encrypted)
   */
  private async saveTokens(tokens: Credentials): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    const tokenPath = join(this.configDir, TOKEN_FILE);

    const tokenJson = JSON.stringify(tokens);

    if (this.encryptionKey) {
      // Encrypt tokens before saving
      const { encryptToJson } = await import('./encrypt.js');
      const encrypted = encryptToJson(Buffer.from(tokenJson), this.encryptionKey);
      const stored: StoredToken = {
        encrypted: JSON.stringify(encrypted),
        isEncrypted: true,
      };
      await writeFile(tokenPath, JSON.stringify(stored, null, 2));
    } else {
      const stored: StoredToken = {
        encrypted: tokenJson,
        isEncrypted: false,
      };
      await writeFile(tokenPath, JSON.stringify(stored, null, 2));
    }
  }

  /**
   * Load tokens from file
   */
  private async loadTokens(): Promise<Credentials | null> {
    const tokenPath = join(this.configDir, TOKEN_FILE);

    try {
      const content = await readFile(tokenPath, 'utf-8');
      const stored: StoredToken = JSON.parse(content);

      if (stored.isEncrypted) {
        if (!this.encryptionKey) {
          throw new Error('Tokens are encrypted but no encryption key provided');
        }
        const { decryptFromJson } = await import('./encrypt.js');
        const encrypted = JSON.parse(stored.encrypted);
        const decrypted = decryptFromJson(encrypted, this.encryptionKey);
        return JSON.parse(decrypted.toString());
      } else {
        return JSON.parse(stored.encrypted);
      }
    } catch {
      return null;
    }
  }

  /**
   * Check if client is authorized (has valid tokens)
   */
  async isAuthorized(): Promise<boolean> {
    const tokens = await this.loadTokens();
    return tokens !== null && tokens.refresh_token !== null;
  }

  /**
   * Initialize Drive API client with saved tokens
   */
  private async initDrive(): Promise<void> {
    if (this.drive) return;

    const tokens = await this.loadTokens();
    if (!tokens) {
      throw new Error('Not authorized. Run authorization flow first.');
    }

    const { google } = await import('googleapis');
    const client = await this.initClient();
    client.setCredentials(tokens);

    // Set up token refresh callback
    client.on?.('tokens', async (newTokens: Credentials) => {
      // Merge with existing tokens (keep refresh_token if not returned)
      const merged = { ...tokens, ...newTokens };
      await this.saveTokens(merged);
    });

    this.drive = google.drive({ version: 'v3', auth: client });
  }

  /**
   * Find or create backup folder
   */
  async findOrCreateFolder(folderName: string): Promise<string> {
    await this.initDrive();

    const drive = this.drive as {
      files: {
        list(params: unknown): Promise<{ data: { files?: DriveFile[] } }>;
        create(params: unknown): Promise<{ data: DriveFile }>;
      };
    };

    // Search for existing folder
    const response = await drive.files.list({
      q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    const files = response.data.files;
    if (files && files.length > 0 && files[0].id) {
      return files[0].id;
    }

    // Create new folder
    const createResponse = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });

    if (!createResponse.data.id) {
      throw new Error('Failed to create backup folder');
    }

    return createResponse.data.id;
  }

  /**
   * Upload a file to Google Drive
   *
   * @param filename - Name for the file in Drive
   * @param content - File content as Buffer
   * @param folderId - Parent folder ID
   * @returns File ID
   */
  async uploadFile(filename: string, content: Buffer, folderId: string): Promise<string> {
    await this.initDrive();

    const drive = this.drive as {
      files: {
        create(params: unknown): Promise<{ data: DriveFile }>;
      };
    };

    const response = await drive.files.create({
      requestBody: {
        name: filename,
        parents: [folderId],
      },
      media: {
        mimeType: 'application/octet-stream',
        body: Readable.from(content),
      },
      fields: 'id, name, size',
    });

    if (!response.data.id) {
      throw new Error('Failed to upload file');
    }

    return response.data.id;
  }

  /**
   * Download a file from Google Drive
   *
   * @param fileId - File ID in Drive
   * @returns File content as Buffer
   */
  async downloadFile(fileId: string): Promise<Buffer> {
    await this.initDrive();

    const drive = this.drive as {
      files: {
        get(params: unknown): Promise<{ data: Buffer | NodeJS.ReadableStream }>;
      };
    };

    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );

    return Buffer.from(response.data as ArrayBuffer);
  }

  /**
   * List backup files in folder
   *
   * @param folderId - Folder ID
   * @returns List of backup files
   */
  async listBackups(folderId: string): Promise<DriveFile[]> {
    await this.initDrive();

    const drive = this.drive as {
      files: {
        list(params: unknown): Promise<{ data: { files?: DriveFile[] } }>;
      };
    };

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, size, modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 100,
    });

    return response.data.files ?? [];
  }

  /**
   * Delete a file from Google Drive
   *
   * @param fileId - File ID to delete
   */
  async deleteFile(fileId: string): Promise<void> {
    await this.initDrive();

    const drive = this.drive as {
      files: {
        delete(params: unknown): Promise<void>;
      };
    };

    await drive.files.delete({ fileId });
  }

  /**
   * Delete oldest backups to maintain retention policy
   *
   * @param folderId - Backup folder ID
   * @param keepCount - Number of backups to keep
   */
  async pruneOldBackups(folderId: string, keepCount: number): Promise<number> {
    const backups = await this.listBackups(folderId);

    if (backups.length <= keepCount) {
      return 0;
    }

    // Sort by date (oldest first) and delete excess
    const toDelete = backups.slice(keepCount);
    let deleted = 0;

    for (const file of toDelete) {
      if (file.id) {
        try {
          await this.deleteFile(file.id);
          deleted++;
        } catch (error) {
          console.error(`Failed to delete ${file.name}:`, error);
        }
      }
    }

    return deleted;
  }
}

/**
 * Create a Google Drive client
 *
 * @param configDir - Directory for storing tokens
 * @param encryptionKey - Optional key for encrypting stored tokens
 */
export function createDriveClient(
  configDir: string,
  encryptionKey?: string
): GoogleDriveClient {
  return new GoogleDriveClient(configDir, encryptionKey);
}
