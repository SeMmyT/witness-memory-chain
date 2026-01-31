/**
 * OpenTimestamps Anchor Types
 *
 * Types for Bitcoin timestamping via OpenTimestamps protocol.
 */

/** Status of an anchor */
export type AnchorStatus = 'pending' | 'confirmed' | 'failed';

/** An anchor record linking a chain entry to an OTS proof */
export interface AnchorRecord {
  /** Sequence number of the anchored entry */
  seq: number;
  /** SHA-256 hash of the entry that was anchored */
  entryHash: string;
  /** Status of the anchor */
  status: AnchorStatus;
  /** ISO 8601 timestamp when anchor was submitted */
  submittedAt: string;
  /** ISO 8601 timestamp when anchor was confirmed (if confirmed) */
  confirmedAt?: string;
  /** Bitcoin block height (if confirmed) */
  blockHeight?: number;
  /** Bitcoin block timestamp (if confirmed) */
  blockTimestamp?: string;
  /** Error message (if failed) */
  error?: string;
}

/** Pending anchors state file structure */
export interface PendingAnchorsFile {
  /** Version of the file format */
  version: 1;
  /** Pending anchor records */
  anchors: AnchorRecord[];
  /** Last check timestamp */
  lastCheck?: string;
}

/** Result of anchor submission */
export interface AnchorSubmitResult {
  /** Whether submission was successful */
  success: boolean;
  /** Sequence number of the anchored entry */
  seq: number;
  /** Path to the .ots proof file */
  otsPath?: string;
  /** Error message (if failed) */
  error?: string;
}

/** Result of anchor verification */
export interface AnchorVerifyResult {
  /** Sequence number of the verified entry */
  seq: number;
  /** Whether the anchor is valid */
  valid: boolean;
  /** Current status */
  status: AnchorStatus;
  /** Bitcoin block height (if confirmed) */
  blockHeight?: number;
  /** Bitcoin block timestamp (if confirmed) */
  blockTimestamp?: string;
  /** Error message (if verification failed) */
  error?: string;
}

/** Result of batch anchor status check */
export interface AnchorStatusResult {
  /** Total anchors */
  total: number;
  /** Pending anchors count */
  pending: number;
  /** Confirmed anchors count */
  confirmed: number;
  /** Failed anchors count */
  failed: number;
  /** Details by entry */
  anchors: AnchorRecord[];
  /** Newly confirmed anchors (upgraded from pending) */
  newlyConfirmed: number;
}

/** Options for anchor operations */
export interface AnchorOptions {
  /** Calendar server URLs (default: OpenTimestamps public servers) */
  calendars?: string[];
  /** Bitcoin RPC URL for local verification (optional) */
  bitcoinRpcUrl?: string;
  /** Timeout for calendar operations in milliseconds */
  timeout?: number;
}

/** Verification result including optional anchor info */
export interface VerificationWithAnchorsResult {
  /** Basic verification result */
  chainValid: boolean;
  entriesChecked: number;
  /** Anchor verification results */
  anchorsChecked: number;
  anchorsValid: number;
  anchorsPending: number;
  anchorsMissing: number;
  /** Detailed anchor results */
  anchorResults: AnchorVerifyResult[];
}
