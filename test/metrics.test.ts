/**
 * Metrics Tests
 *
 * Tests for metrics/telemetry functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  InMemoryMetricsCollector,
  setMetricsCollector,
  getMetricsCollector,
  recordMetric,
  emitMetric,
  startTimer,
  timeOperation,
  timeOperationSync,
  enableMetrics,
  disableMetrics,
  getMetricsSummary,
} from '../src/metrics.js';
import type { MetricEvent } from '../src/types.js';

// Reset metrics between tests
beforeEach(() => {
  disableMetrics();
});

afterEach(() => {
  disableMetrics();
});

// ============================================================================
// InMemoryMetricsCollector Tests
// ============================================================================

describe('InMemoryMetricsCollector', () => {
  it('should record events', () => {
    const collector = new InMemoryMetricsCollector();

    collector.record({
      type: 'chain_init',
      timestamp: new Date().toISOString(),
    });

    expect(collector.getEvents().length).toBe(1);
  });

  it('should limit events to maxEvents', () => {
    const collector = new InMemoryMetricsCollector(5);

    for (let i = 0; i < 10; i++) {
      collector.record({
        type: 'entry_add',
        timestamp: new Date().toISOString(),
        data: { index: i },
      });
    }

    const events = collector.getEvents();
    expect(events.length).toBe(5);
    // Should keep the latest events
    expect((events[0].data as { index: number }).index).toBe(5);
  });

  it('should clear events', () => {
    const collector = new InMemoryMetricsCollector();

    collector.record({
      type: 'chain_init',
      timestamp: new Date().toISOString(),
    });

    collector.clear();

    expect(collector.getEvents().length).toBe(0);
  });

  it('should filter events by type', () => {
    const collector = new InMemoryMetricsCollector();

    collector.record({ type: 'chain_init', timestamp: '' });
    collector.record({ type: 'entry_add', timestamp: '' });
    collector.record({ type: 'entry_add', timestamp: '' });
    collector.record({ type: 'chain_verify', timestamp: '' });

    const addEvents = collector.getEventsByType('entry_add');
    expect(addEvents.length).toBe(2);
  });

  it('should calculate summary statistics', () => {
    const collector = new InMemoryMetricsCollector();

    collector.record({ type: 'chain_init', timestamp: '', durationMs: 100 });
    collector.record({ type: 'entry_add', timestamp: '', durationMs: 10 });
    collector.record({ type: 'entry_add', timestamp: '', durationMs: 20 });

    const summary = collector.getSummary();

    expect(summary.totalEvents).toBe(3);
    expect(summary.byType['chain_init']).toBe(1);
    expect(summary.byType['entry_add']).toBe(2);
    expect(summary.averageDurationMs['chain_init']).toBe(100);
    expect(summary.averageDurationMs['entry_add']).toBe(15);
  });
});

// ============================================================================
// Global Metrics Tests
// ============================================================================

describe('Global Metrics', () => {
  it('should set and get collector', () => {
    const collector = new InMemoryMetricsCollector();
    setMetricsCollector(collector);

    expect(getMetricsCollector()).toBe(collector);
  });

  it('should record metric through global function', () => {
    const collector = new InMemoryMetricsCollector();
    setMetricsCollector(collector);

    recordMetric({
      type: 'chain_init',
      timestamp: new Date().toISOString(),
    });

    expect(collector.getEvents().length).toBe(1);
  });

  it('should emit metric with auto-timestamp', () => {
    const collector = new InMemoryMetricsCollector();
    setMetricsCollector(collector);

    emitMetric('entry_add', { seq: 1 }, 50);

    const events = collector.getEvents();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('entry_add');
    expect(events[0].durationMs).toBe(50);
    expect(events[0].data).toEqual({ seq: 1 });
    expect(events[0].timestamp).toBeTruthy();
  });

  it('should not error when no collector is set', () => {
    setMetricsCollector(null);

    // Should not throw
    recordMetric({ type: 'chain_init', timestamp: '' });
    emitMetric('entry_add');
  });
});

// ============================================================================
// Timer Tests
// ============================================================================

describe('Metric Timer', () => {
  it('should measure duration', async () => {
    const collector = new InMemoryMetricsCollector();
    setMetricsCollector(collector);

    const timer = startTimer('entry_add', { seq: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const duration = timer.stop({ success: true });

    expect(duration).toBeGreaterThan(5);
    expect(collector.getEvents().length).toBe(1);

    const event = collector.getEvents()[0];
    expect(event.type).toBe('entry_add');
    expect(event.durationMs).toBeDefined();
    expect(event.data).toEqual({ seq: 1, success: true });
  });

  it('should time async operation', async () => {
    const collector = new InMemoryMetricsCollector();
    setMetricsCollector(collector);

    const result = await timeOperation(
      'retrieval_query',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'result';
      },
      { query: 'test' }
    );

    expect(result).toBe('result');
    expect(collector.getEvents().length).toBe(1);

    const event = collector.getEvents()[0];
    expect(event.type).toBe('retrieval_query');
    expect(event.data).toEqual({ query: 'test', success: true });
  });

  it('should record failure on error', async () => {
    const collector = new InMemoryMetricsCollector();
    setMetricsCollector(collector);

    await expect(
      timeOperation('entry_add', async () => {
        throw new Error('Test error');
      })
    ).rejects.toThrow('Test error');

    const event = collector.getEvents()[0];
    expect(event.data?.success).toBe(false);
    expect(event.data?.error).toBe('Test error');
  });

  it('should time sync operation', () => {
    const collector = new InMemoryMetricsCollector();
    setMetricsCollector(collector);

    const result = timeOperationSync('content_read', () => {
      return 'sync result';
    });

    expect(result).toBe('sync result');
    expect(collector.getEvents().length).toBe(1);
    expect(collector.getEvents()[0].type).toBe('content_read');
  });
});

// ============================================================================
// Convenience Functions Tests
// ============================================================================

describe('Convenience Functions', () => {
  it('should enable metrics with default collector', () => {
    const collector = enableMetrics();

    expect(collector).toBeInstanceOf(InMemoryMetricsCollector);
    expect(getMetricsCollector()).toBe(collector);
  });

  it('should disable metrics', () => {
    enableMetrics();
    disableMetrics();

    expect(getMetricsCollector()).toBeNull();
  });

  it('should get metrics summary', () => {
    enableMetrics();
    emitMetric('chain_init', {}, 100);
    emitMetric('entry_add', {}, 10);

    const summary = getMetricsSummary();

    expect(summary).not.toBeNull();
    expect(summary?.totalEvents).toBe(2);
  });

  it('should return null summary when not using in-memory collector', () => {
    // Custom collector that isn't InMemoryMetricsCollector
    setMetricsCollector({
      record: () => {},
      getEvents: () => [],
      clear: () => {},
    });

    const summary = getMetricsSummary();
    expect(summary).toBeNull();
  });
});
