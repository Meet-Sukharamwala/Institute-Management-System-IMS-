import { Request, Response, NextFunction } from 'express';
import { getDb } from './db';
import { AuthUser, Permission, RoleCode } from '../shared/types';
import { writeAuditLog } from './audit';

export const SESSION_COOKIE_NAME = 'ims_session_id';

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      sessionId?: string;
      csrfToken?: string;
    }
  }
}

export function loadUserById(userId: number): AuthUser | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.branch_id, u.mfa_enabled, u.is_active,
              r.id as role_id, r.code as role_code, r.name as role_name,
              b.name as branch_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.id = ?`
    )
    .get(userId) as
    | {
        id: number;
        email: string;
        full_name: string;
        branch_id: number | null;
        mfa_enabled: number;
        is_active: number;
        role_id: number;
        role_code: RoleCode;
        role_name: string;
        branch_name: string | null;
      }
    | undefined;

  if (!row || !row.is_active) return null;

  const perms = db
    .prepare('SELECT permission FROM role_permissions WHERE role_id = ?')
    .all(row.role_id) as Array<{ permission: Permission }>;

  const teacher = db
    .prepare('SELECT id FROM teachers WHERE user_id = ?')
    .get(row.id) as { id: number } | undefined;
  const student = db
    .prepare('SELECT id FROM students WHERE user_id = ?')
    .get(row.id) as { id: number } | undefined;
  const guardian = db
    .prepare('SELECT id FROM guardians WHERE user_id = ?')
    .get(row.id) as { id: number } | undefined;

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    roleCode: row.role_code,
    roleName: row.role_name,
    branchId: row.branch_id,
    branchName: row.branch_name,
    permissions: perms.map((p) => p.permission),
    mfaEnabled: Boolean(row.mfa_enabled),
    teacherId: teacher?.id ?? null,
    studentId: student?.id ?? null,
    guardianId: guardian?.id ?? null,
  };
}

export function authenticateMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const tokenFromCookie = req.cookies?.[SESSION_COOKIE_NAME];
  const authHeader = req.headers.authorization;
  const tokenFromBearer =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  const sessionId = tokenFromCookie || tokenFromBearer;
  if (!sessionId) {
    next();
    return;
  }

  const db = getDb();
  const session = db
    .prepare(
      `SELECT id, user_id, csrf_token, expires_at_ms, revoked_at
       FROM auth_sessions WHERE id = ?`
    )
    .get(sessionId) as
    | {
        id: string;
        user_id: number;
        csrf_token: string;
        expires_at_ms: number;
        revoked_at: string | null;
      }
    | undefined;

  if (!session || session.revoked_at || Date.now() > session.expires_at_ms) {
    next();
    return;
  }

  const user = loadUserById(session.user_id);
  if (user) {
    req.authUser = user;
    req.sessionId = session.id;
    req.csrfToken = session.csrf_token;
  }
  next();
}

export function csrfProtectionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  if (safeMethods.has(req.method)) {
    next();
    return;
  }
  // Exempt unauthenticated auth entry endpoints
  if (
    req.path === '/api/auth/login' ||
    req.path === '/api/auth/password-reset/request' ||
    req.path === '/api/auth/password-reset/confirm'
  ) {
    next();
    return;
  }
  // Only enforce CSRF token match when authenticating via browser cookie session
  if (req.cookies?.[SESSION_COOKIE_NAME] && req.csrfToken) {
    const headerToken = req.headers['x-csrf-token'];
    if (!headerToken || headerToken !== req.csrfToken) {
      res.status(403).json({
        error: 'CSRF_TOKEN_INVALID',
        message: 'Security token validation failed. Please refresh your session.',
      });
      return;
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({
      error: 'UNAUTHENTICATED',
      message: 'Authentication required. Please sign in to continue.',
    });
    return;
  }
  next();
}

export function requirePermission(...required: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
      return;
    }
    const hasAny = required.some((perm) => req.authUser!.permissions.includes(perm));
    if (!hasAny) {
      writeAuditLog({
        actor: req.authUser,
        action: `UNAUTHORIZED_ATTEMPT:${req.method}:${req.originalUrl}`,
        entityType: 'endpoint',
        entityId: req.path,
        outcome: 'DENIED',
      });
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'You do not have permission to perform this operation.',
      });
      return;
    }
    next();
  };
}

/**
 * Resolves the effective branch scope for any backend query or mutation.
 * Non-Super-Admin users without `branch:switch` are strictly pinned to their own assigned branchId,
 * even if they attempt to pass another `branchId` in query or body parameters.
 */
export function resolveScopedBranchId(
  user: AuthUser,
  requestedBranchId?: number | string | null
): { allowed: boolean; branchId: number | null } {
  const parsed =
    requestedBranchId !== undefined && requestedBranchId !== null && requestedBranchId !== '' && requestedBranchId !== 'ALL'
      ? Number(requestedBranchId)
      : null;

  const canSwitch =
    user.roleCode === RoleCode.SUPER_ADMIN || user.permissions.includes(Permission.BRANCH_SWITCH);

  if (canSwitch) {
    return { allowed: true, branchId: Number.isFinite(parsed) ? parsed : null };
  }

  // Restricted to user's assigned branch
  if (user.branchId === null) {
    return { allowed: false, branchId: null };
  }
  if (parsed !== null && parsed !== user.branchId) {
    return { allowed: false, branchId: user.branchId };
  }
  return { allowed: true, branchId: user.branchId };
}
