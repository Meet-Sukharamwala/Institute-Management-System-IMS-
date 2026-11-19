import crypto from 'node:crypto';
import { getDb } from './db';
import { AuthUser } from '../shared/types';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'code_hash',
  'codeHash',
  'plainCode',
  'mfa_pin_hash',
  'csrf_token',
  'token_hash',
]);

function scrubSensitive(obj: unknown): string | null {
  if (obj === undefined || obj === null) return null;
  try {
    return JSON.stringify(obj, (key, value) => {
      if (SENSITIVE_KEYS.has(key)) return '[REDACTED]';
      return value;
    });
  } catch {
    return null;
  }
}

export interface AuditEntryInput {
  actor: Pick<AuthUser, 'id' | 'fullName' | 'roleCode' | 'branchId'> | null;
  branchId?: number | null;
  action: string;
  entityType: string;
  entityId: string | number;
  before?: unknown;
  after?: unknown;
  outcome?: 'SUCCESS' | 'DENIED' | 'FAILURE';
  correlationId?: string;
}

export function writeAuditLog(entry: AuditEntryInput): void {
  const db = getDb();
  const correlationId = entry.correlationId || crypto.randomUUID();
  db.prepare(
    `INSERT INTO audit_logs (
      actor_user_id, actor_name, actor_role, branch_id, action, entity_type, entity_id,
      before_json, after_json, outcome, correlation_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.actor?.id ?? null,
    entry.actor?.fullName ?? 'System / Unauthenticated',
    entry.actor?.roleCode ?? 'ANONYMOUS',
    entry.branchId !== undefined ? entry.branchId : (entry.actor?.branchId ?? null),
    entry.action,
    entry.entityType,
    String(entry.entityId),
    scrubSensitive(entry.before),
    scrubSensitive(entry.after),
    entry.outcome ?? 'SUCCESS',
    correlationId,
    new Date().toISOString()
  );
}
