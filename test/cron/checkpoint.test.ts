/**
 * Checkpoint Tests
 *
 * Tests for the hourly memory checkpoint functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  classifySignificance,
  isWorthCapturing,
  extractSignificantContent,
  writeToDailyFile,
  runCheckpoint,
  parseDailyFile,
} from '../../src/cron/checkpoint.js';
import type { SessionMessage } from '../../src/cron/types.js';

describe('Checkpoint', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checkpoint-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('classifySignificance', () => {
    it('should detect explicit memory requests', () => {
      expect(classifySignificance('Remember this important thing')).toBe('explicit');
      expect(classifySignificance("Don't forget to check the logs")).toBe('explicit');
      expect(classifySignificance('Note that this is crucial')).toBe('explicit');
    });

    it('should detect decisions', () => {
      expect(classifySignificance('We decided to use TypeScript')).toBe('decision');
      expect(classifySignificance("I'm going with React for this project")).toBe('decision');
      expect(classifySignificance('The team approved the design')).toBe('decision');
    });

    it('should detect preferences', () => {
      expect(classifySignificance('I prefer dark mode')).toBe('preference');
      expect(classifySignificance('I like functional programming')).toBe('preference');
      expect(classifySignificance('I always use tabs over spaces')).toBe('preference');
    });

    it('should detect events', () => {
      expect(classifySignificance('We completed the feature')).toBe('event');
      expect(classifySignificance('I figured out the bug')).toBe('event');
      expect(classifySignificance('The app was deployed')).toBe('event');
    });

    it('should return null for non-significant content', () => {
      expect(classifySignificance('Hello world')).toBe(null);
      expect(classifySignificance('What time is it?')).toBe(null);
    });
  });

  describe('isWorthCapturing', () => {
    it('should reject short messages', () => {
      const message: SessionMessage = {
        role: 'user',
        content: 'ok',
        timestamp: new Date().toISOString(),
      };
      expect(isWorthCapturing(message)).toBe(false);
    });

    it('should reject common acknowledgments', () => {
      const acks = ['ok', 'sure', 'got it', 'sounds good', 'makes sense'];
      for (const ack of acks) {
        const message: SessionMessage = {
          role: 'user',
          content: ack,
          timestamp: new Date().toISOString(),
        };
        expect(isWorthCapturing(message)).toBe(false);
      }
    });

    it('should reject code-heavy messages', () => {
      const message: SessionMessage = {
        role: 'user',
        content: '```javascript\nfunction foo() { return bar; }\n```',
        timestamp: new Date().toISOString(),
      };
      expect(isWorthCapturing(message)).toBe(false);
    });

    it('should accept meaningful content', () => {
      const message: SessionMessage = {
        role: 'user',
        content: 'I prefer using Vue.js for frontend development because of the Composition API',
        timestamp: new Date().toISOString(),
      };
      expect(isWorthCapturing(message)).toBe(true);
    });
  });

  describe('extractSignificantContent', () => {
    it('should extract significant user messages', () => {
      const messages: SessionMessage[] = [
        { role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
        { role: 'user', content: 'I decided to use pnpm for package management', timestamp: new Date().toISOString() },
        { role: 'assistant', content: 'That sounds good', timestamp: new Date().toISOString() },
      ];

      const items = extractSignificantContent(messages);

      expect(items.length).toBe(1);
      expect(items[0].significance).toBe('decision');
      expect(items[0].source).toBe('auto');
    });

    it('should handle empty messages', () => {
      const items = extractSignificantContent([]);
      expect(items.length).toBe(0);
    });
  });

  describe('writeToDailyFile', () => {
    it('should create daily file with header', async () => {
      const items = [
        {
          content: 'Test decision',
          significance: 'decision' as const,
          source: 'auto' as const,
          timestamp: new Date().toISOString(),
        },
      ];

      const filePath = await writeToDailyFile(items, testDir);

      expect(await fs.access(filePath).then(() => true).catch(() => false)).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('# Memory Capture');
      expect(content).toContain('Decision');
      expect(content).toContain('Test decision');
    });

    it('should append to existing file', async () => {
      const items1 = [
        {
          content: 'First item',
          significance: 'decision' as const,
          source: 'auto' as const,
          timestamp: new Date().toISOString(),
        },
      ];
      const items2 = [
        {
          content: 'Second item',
          significance: 'preference' as const,
          source: 'auto' as const,
          timestamp: new Date().toISOString(),
        },
      ];

      await writeToDailyFile(items1, testDir);
      await writeToDailyFile(items2, testDir);

      const today = new Date().toISOString().split('T')[0];
      const filePath = path.join(testDir, 'memory', `${today}.md`);
      const content = await fs.readFile(filePath, 'utf-8');

      expect(content).toContain('First item');
      expect(content).toContain('Second item');
    });
  });

  describe('parseDailyFile', () => {
    it('should parse daily file back into items', async () => {
      const items = [
        {
          content: 'Parsed content',
          significance: 'event' as const,
          source: 'auto' as const,
          timestamp: new Date().toISOString(),
        },
      ];

      const filePath = await writeToDailyFile(items, testDir);
      const parsed = await parseDailyFile(filePath);

      expect(parsed.length).toBe(1);
      expect(parsed[0].content).toBe('Parsed content');
      expect(parsed[0].significance).toBe('event');
    });
  });

  describe('runCheckpoint', () => {
    it('should run full checkpoint workflow', async () => {
      const chainDir = path.join(testDir, 'chain');
      await fs.mkdir(chainDir, { recursive: true });

      const messages: SessionMessage[] = [
        {
          role: 'user',
          content: 'I prefer using conventional commits for all my projects',
          timestamp: new Date().toISOString(),
        },
        {
          role: 'user',
          content: 'ok sounds good',
          timestamp: new Date().toISOString(),
        },
      ];

      const result = await runCheckpoint(messages, {
        workspaceDir: testDir,
        chainDir,
      });

      expect(result.capturedCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.duplicatesFound).toBe(0);
      expect(result.errors.length).toBe(0);
    });
  });
});
