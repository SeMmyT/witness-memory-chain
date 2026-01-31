/**
 * Metrics and Telemetry
 *
 * Provides observability hooks for monitoring memory-chain operations.
 * Supports pluggable collectors for integration with various monitoring systems.
 */

import type { MetricEvent, MetricEventType, MetricsCollector } from './types.js';

// ============================================================================
// Default In-Memory Collector
// ============================================================================

/**
 * Simple in-memory metrics collector
 *
 * Stores events in an array with optional size limits.
 */
export class InMemoryMetricsCollector implements MetricsCollector {
  private events: MetricEvent[] = [];
  private maxEvents: number;

  /**
   * Create a new in-memory collector
   *
   * @param maxEvents - Maximum events to store (0 = unlimited)
   */
  constructor(maxEvents = 1000) {
    this.maxEvents = maxEvents;
  }

  record(event: MetricEvent): void {
    this.events.push(event);

    // Trim if over limit
    if (this.maxEvents > 0 && this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  getEvents(): MetricEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }

  /**
   * Get events filtered by type
   */
  getEventsByType(type: MetricEventType): MetricEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalEvents: number;
    byType: Record<string, number>;
    averageDurationMs: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    const durations: Record<string, number[]> = {};

    for (const event of this.events) {
      byType[event.type] = (byType[event.type] || 0) + 1;

      if (event.durationMs !== undefined) {
        if (!durations[event.type]) {
          durations[event.type] = [];
        }
        durations[event.type].push(event.durationMs);
      }
    }

    const averageDurationMs: Record<string, number> = {};
    for (const [type, durs] of Object.entries(durations)) {
      if (durs.length > 0) {
        averageDurationMs[type] = durs.reduce((a, b) => a + b, 0) / durs.length;
      }
    }

    return {
      totalEvents: this.events.length,
      byType,
      averageDurationMs,
    };
  }
}

// ============================================================================
// Global Metrics Registry
// ============================================================================

/** Global metrics collector instance */
let globalCollector: MetricsCollector | null = null;

/**
 * Set the global metrics collector
 *
 * @param collector - Metrics collector to use (null to disable)
 */
export function setMetricsCollector(collector: MetricsCollector | null): void {
  globalCollector = collector;
}

/**
 * Get the current global metrics collector
 */
export function getMetricsCollector(): MetricsCollector | null {
  return globalCollector;
}

/**
 * Record a metric event if a collector is configured
 *
 * @param event - Event to record
 */
export function recordMetric(event: MetricEvent): void {
  if (globalCollector) {
    globalCollector.record(event);
  }
}

/**
 * Create and record a metric event with current timestamp
 *
 * @param type - Event type
 * @param data - Additional event data
 * @param durationMs - Optional duration
 */
export function emitMetric(
  type: MetricEventType,
  data?: Record<string, unknown>,
  durationMs?: number
): void {
  recordMetric({
    type,
    timestamp: new Date().toISOString(),
    durationMs,
    data,
  });
}

// ============================================================================
// Timing Helpers
// ============================================================================

/**
 * Timer for measuring operation duration
 */
export class MetricTimer {
  private startTime: number;
  private type: MetricEventType;
  private data?: Record<string, unknown>;

  constructor(type: MetricEventType, data?: Record<string, unknown>) {
    this.startTime = performance.now();
    this.type = type;
    this.data = data;
  }

  /**
   * Stop the timer and emit the metric
   *
   * @param additionalData - Additional data to merge
   */
  stop(additionalData?: Record<string, unknown>): number {
    const durationMs = performance.now() - this.startTime;
    const mergedData = { ...this.data, ...additionalData };

    emitMetric(this.type, Object.keys(mergedData).length > 0 ? mergedData : undefined, durationMs);

    return durationMs;
  }
}

/**
 * Start a timer for an operation
 *
 * @param type - Event type
 * @param data - Initial event data
 * @returns Timer instance
 */
export function startTimer(type: MetricEventType, data?: Record<string, unknown>): MetricTimer {
  return new MetricTimer(type, data);
}

/**
 * Time an async operation and record the metric
 *
 * @param type - Event type
 * @param operation - Async operation to time
 * @param data - Additional event data
 * @returns Result of the operation
 */
export async function timeOperation<T>(
  type: MetricEventType,
  operation: () => Promise<T>,
  data?: Record<string, unknown>
): Promise<T> {
  const timer = startTimer(type, data);
  try {
    const result = await operation();
    timer.stop({ success: true });
    return result;
  } catch (err) {
    timer.stop({ success: false, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/**
 * Time a sync operation and record the metric
 *
 * @param type - Event type
 * @param operation - Sync operation to time
 * @param data - Additional event data
 * @returns Result of the operation
 */
export function timeOperationSync<T>(
  type: MetricEventType,
  operation: () => T,
  data?: Record<string, unknown>
): T {
  const timer = startTimer(type, data);
  try {
    const result = operation();
    timer.stop({ success: true });
    return result;
  } catch (err) {
    timer.stop({ success: false, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Enable metrics collection with default in-memory collector
 *
 * @param maxEvents - Maximum events to store
 * @returns The collector instance
 */
export function enableMetrics(maxEvents = 1000): InMemoryMetricsCollector {
  const collector = new InMemoryMetricsCollector(maxEvents);
  setMetricsCollector(collector);
  return collector;
}

/**
 * Disable metrics collection
 */
export function disableMetrics(): void {
  setMetricsCollector(null);
}

/**
 * Get metrics summary if using in-memory collector
 */
export function getMetricsSummary(): ReturnType<InMemoryMetricsCollector['getSummary']> | null {
  if (globalCollector instanceof InMemoryMetricsCollector) {
    return globalCollector.getSummary();
  }
  return null;
}
