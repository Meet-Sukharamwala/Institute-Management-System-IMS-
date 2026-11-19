import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, getDbPath, closeAndResetDbInstance } from '../db';
import {
  hashPassword,
  verifyPassword,
  generateSecureToken,
  hashVerificationSecret,
  verifyVerificationSecret,
} from '../crypto';
import {
  SESSION_COOKIE_NAME,
  loadUserById,
  requireAuth,
  requirePermission,
  resolveScopedBranchId,
} from '../auth';
import { Permission, RoleCode } from '../../shared/types';
import { writeAuditLog } from '../audit';
import { DEV_SAMPLE_PASSWORD, ensureSeedData } from '../seed';

export const authAdminRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfaCode: z.string().optional(),
});

// Simple IP rate limiter for login attempts
const ipLoginBucket = new Map<string, { count: number; resetAtMs: number }>();

authAdminRouter.post('/auth/login', (req, res) => {
  const ip = req.ip || 'local';
  const nowMs = Date.now();
  const bucket = ipLoginBucket.get(ip);
  if (bucket && nowMs < bucket.resetAtMs && bucket.count >= 20) {
    res.status(429).json({
      error: 'RATE_LIMITED',
      message: 'Too many login attempts from this network. Please wait a minute.',
    });
    return;
  }

  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Valid email and password are required.' });
    return;
  }

  const { email, password, mfaCode } = parsed.data;
  const db = getDb();
  const userRow = db
    .prepare(
      `SELECT id, email, password_hash, full_name, mfa_enabled, mfa_pin_hash,
              is_active, failed_login_attempts, locked_until_ms
       FROM users WHERE lower(email) = lower(?)`
    )
    .get(email.trim()) as
    | {
        id: number;
        email: string;
        password_hash: string;
        full_name: string;
        mfa_enabled: number;
        mfa_pin_hash: string | null;
        is_active: number;
        failed_login_attempts: number;
        locked_until_ms: number | null;
      }
    | undefined;

  if (!userRow || !userRow.is_active) {
    ipLoginBucket.set(ip, {
      count: (bucket?.count ?? 0) + 1,
      resetAtMs: bucket && nowMs < bucket.resetAtMs ? bucket.resetAtMs : nowMs + 60_000,
    });
    res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    return;
  }

  if (userRow.locked_until_ms && nowMs < userRow.locked_until_ms) {
    res.status(429).json({
      error: 'ACCOUNT_LOCKED',
      message: 'Account temporarily locked after repeated failed attempts. Try again shortly.',
    });
    return;
  }

  const ok = verifyPassword(password, userRow.password_hash);
  if (!ok) {
    const fails = userRow.failed_login_attempts + 1;
    const lockUntil = fails >= 5 ? nowMs + 5 * 60_000 : null;
    db.prepare('UPDATE users SET failed_login_attempts = ?, locked_until_ms = ? WHERE id = ?').run(
      fails,
      lockUntil,
      userRow.id
    );
    writeAuditLog({
      actor: null,
      action: 'AUTH_LOGIN_FAILED',
      entityType: 'users',
      entityId: userRow.id,
      outcome: 'FAILURE',
    });
    res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    return;
  }

  if (userRow.mfa_enabled && userRow.mfa_pin_hash) {
    if (!mfaCode) {
      res.status(200).json({ mfaRequired: true, message: 'Enter your 6-digit privileged MFA PIN.' });
      return;
    }
    const mfaValid = verifyVerificationSecret(mfaCode, 'mfa-static-salt', userRow.mfa_pin_hash);
    if (!mfaValid) {
      res.status(401).json({ error: 'INVALID_MFA', message: 'Invalid MFA verification PIN.' });
      return;
    }
  }

  db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until_ms = NULL WHERE id = ?').run(
    userRow.id
  );

  const sessionId = generateSecureToken(32);
  const csrfToken = generateSecureToken(24);
  const ttlHours = Number(process.env.SESSION_TTL_HOURS || 12);
  const expiresAtMs = nowMs + ttlHours * 3600_000;

  db.prepare(
    `INSERT INTO auth_sessions (id, user_id, csrf_token, ip_address, user_agent, expires_at_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    userRow.id,
    csrfToken,
    ip,
    String(req.headers['user-agent'] || '').slice(0, 200),
    expiresAtMs,
    new Date().toISOString()
  );

  const isIframeHttps = process.env.CSRF_COOKIE_SECURE === 'true' || req.secure;
  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: isIframeHttps ? 'none' : 'lax',
    secure: isIframeHttps,
    maxAge: ttlHours * 3600_000,
    path: '/',
  });

  const user = loadUserById(userRow.id)!;
  writeAuditLog({
    actor: user,
    action: 'AUTH_LOGIN_SUCCESS',
    entityType: 'auth_sessions',
    entityId: sessionId.slice(0, 10),
  });

  res.json({
    user,
    csrfToken,
    sessionToken: sessionId,
  });
});

authAdminRouter.get('/auth/me', (req, res) => {
  const isDevSandbox = process.env.NODE_ENV !== 'production' && process.env.DISABLE_DEMO_SEED !== 'true';
  const db = getDb();
  let demoAccounts: Array<{ email: string; fullName: string; roleCode: string; branchName: string | null }> = [];
  if (isDevSandbox) {
    demoAccounts = db
      .prepare(
        `SELECT u.email, u.full_name as fullName, r.code as roleCode, b.name as branchName
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN branches b ON b.id = u.branch_id
         WHERE u.is_active = 1
         ORDER BY r.id ASC`
      )
      .all() as Array<{ email: string; fullName: string; roleCode: string; branchName: string | null }>;
  }

  if (!req.authUser) {
    res.json({
      authenticated: false,
      user: null,
      devSandbox: isDevSandbox ? { passwordHint: DEV_SAMPLE_PASSWORD, accounts: demoAccounts } : null,
    });
    return;
  }

  res.json({
    authenticated: true,
    user: req.authUser,
    csrfToken: req.csrfToken,
    devSandbox: isDevSandbox ? { passwordHint: DEV_SAMPLE_PASSWORD, accounts: demoAccounts } : null,
  });
});

authAdminRouter.post('/auth/logout', requireAuth, (req, res) => {
  const db = getDb();
  if (req.sessionId) {
    db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      req.sessionId
    );
  }
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  writeAuditLog({
    actor: req.authUser!,
    action: 'AUTH_LOGOUT',
    entityType: 'auth_sessions',
    entityId: req.sessionId?.slice(0, 10) || 'current',
  });
  res.json({ ok: true });
});

authAdminRouter.post('/auth/revoke-all-sessions', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND id != ?').run(
    new Date().toISOString(),
    req.authUser!.id,
    req.sessionId || ''
  );
  writeAuditLog({
    actor: req.authUser!,
    action: 'AUTH_REVOKE_OTHER_SESSIONS',
    entityType: 'users',
    entityId: req.authUser!.id,
  });
  res.json({ ok: true, message: 'All other active sessions for your account have been revoked.' });
});

authAdminRouter.post('/auth/mfa-toggle', requireAuth, (req, res) => {
  const schema = z.object({
    enabled: z.boolean(),
    pin: z.string().regex(/^\d{6}$/, 'MFA PIN must be 6 digits').optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  if (parsed.data.enabled) {
    const pin = parsed.data.pin || '246810';
    const hash = hashVerificationSecret(pin, 'mfa-static-salt');
    db.prepare('UPDATE users SET mfa_enabled = 1, mfa_pin_hash = ? WHERE id = ?').run(
      hash,
      req.authUser!.id
    );
  } else {
    db.prepare('UPDATE users SET mfa_enabled = 0 WHERE id = ?').run(req.authUser!.id);
  }
  writeAuditLog({
    actor: req.authUser!,
    action: parsed.data.enabled ? 'MFA_ENABLED' : 'MFA_DISABLED',
    entityType: 'users',
    entityId: req.authUser!.id,
  });
  res.json({ ok: true, mfaEnabled: parsed.data.enabled });
});

authAdminRouter.post('/auth/password-reset/request', (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!email) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email is required.' });
    return;
  }
  const db = getDb();
  const u = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND is_active = 1').get(email) as
    | { id: number }
    | undefined;
  let devResetCode: string | null = null;
  if (u) {
    const code = generateSecureToken(4).toUpperCase();
    const salt = generateSecureToken(8);
    const hash = hashVerificationSecret(code, salt);
    db.prepare(
      `INSERT INTO password_resets (user_id, token_hash, salt, expires_at_ms, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(u.id, hash, salt, Date.now() + 15 * 60_000, new Date().toISOString());
    if (!process.env.SMTP_HOST) {
      devResetCode = code;
    }
  }
  res.json({
    ok: true,
    message: 'If an active account matches, a 15-minute password reset code has been generated.',
    devSandboxResetCode: devResetCode,
  });
});

authAdminRouter.post('/auth/password-reset/confirm', (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    resetCode: z.string().min(4),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  const u = db
    .prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND is_active = 1')
    .get(parsed.data.email.trim()) as { id: number } | undefined;
  if (!u) {
    res.status(400).json({ error: 'INVALID_RESET', message: 'Invalid or expired reset token.' });
    return;
  }
  const resetRow = db
    .prepare(
      `SELECT id, token_hash, salt, expires_at_ms
       FROM password_resets
       WHERE user_id = ? AND consumed_at IS NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get(u.id) as { id: number; token_hash: string; salt: string; expires_at_ms: number } | undefined;

  if (
    !resetRow ||
    Date.now() > resetRow.expires_at_ms ||
    !verifyVerificationSecret(parsed.data.resetCode, resetRow.salt, resetRow.token_hash)
  ) {
    res.status(400).json({ error: 'INVALID_RESET', message: 'Invalid or expired reset token.' });
    return;
  }

  const newHash = hashPassword(parsed.data.newPassword);
  const nowIso = new Date().toISOString();
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until_ms = NULL WHERE id = ?').run(
      newHash,
      u.id
    );
    db.prepare('UPDATE password_resets SET consumed_at = ? WHERE id = ?').run(nowIso, resetRow.id);
    db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ?').run(nowIso, u.id);
  })();

  writeAuditLog({
    actor: null,
    action: 'PASSWORD_RESET_COMPLETED',
    entityType: 'users',
    entityId: u.id,
  });

  res.json({ ok: true, message: 'Password updated and existing sessions revoked.' });
});

// ======================== BRANCHES ========================
authAdminRouter.get('/branches', requireAuth, (req, res) => {
  const db = getDb();
  const u = req.authUser!;
  if (u.roleCode === RoleCode.SUPER_ADMIN || u.permissions.includes(Permission.BRANCH_SWITCH)) {
    const branches = db
      .prepare(
        `SELECT id, code, name, city, address, phone, email, is_active as isActive, created_at as createdAt
         FROM branches ORDER BY id ASC`
      )
      .all();
    res.json({ branches });
    return;
  }
  const branches = db
    .prepare(
      `SELECT id, code, name, city, address, phone, email, is_active as isActive, created_at as createdAt
       FROM branches WHERE id = ?`
    )
    .all(u.branchId ?? -1);
  res.json({ branches });
});

authAdminRouter.post('/branches', requirePermission(Permission.BRANCH_MANAGE), (req, res) => {
  const schema = z.object({
    code: z.string().min(2).max(20),
    name: z.string().min(3),
    city: z.string().min(2),
    address: z.string().min(5),
    phone: z.string().min(6),
    email: z.string().email(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  const d = parsed.data;
  try {
    const info = db
      .prepare(
        `INSERT INTO branches (code, name, city, address, phone, email, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
      )
      .run(
        d.code.trim().toUpperCase(),
        d.name.trim(),
        d.city.trim(),
        d.address.trim(),
        d.phone.trim(),
        d.email.trim(),
        new Date().toISOString()
      );
    const id = Number(info.lastInsertRowid);
    writeAuditLog({
      actor: req.authUser!,
      branchId: id,
      action: 'BRANCH_CREATED',
      entityType: 'branches',
      entityId: id,
      after: d,
    });
    res.status(201).json({ id, message: 'Branch created.' });
  } catch (e: unknown) {
    res.status(409).json({
      error: 'CONFLICT',
      message: e instanceof Error && e.message.includes('UNIQUE') ? 'Branch code already exists.' : 'Could not create branch.',
    });
  }
});

// ======================== USERS & CONFIGURABLE PERMISSIONS ========================
authAdminRouter.get('/users', requirePermission(Permission.USER_MANAGE, Permission.ROLE_MANAGE), (req, res) => {
  const scope = resolveScopedBranchId(req.authUser!, req.query.branchId as string | undefined);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Cross-branch user directory access denied.' });
    return;
  }
  const db = getDb();
  const users = scope.branchId
    ? db
        .prepare(
          `SELECT u.id, u.email, u.full_name as fullName, u.phone, u.branch_id as branchId,
                  u.mfa_enabled as mfaEnabled, u.is_active as isActive, u.created_at as createdAt,
                  r.code as roleCode, r.name as roleName, b.name as branchName
           FROM users u
           JOIN roles r ON r.id = u.role_id
           LEFT JOIN branches b ON b.id = u.branch_id
           WHERE u.branch_id = ?
           ORDER BY u.id DESC`
        )
        .all(scope.branchId)
    : db
        .prepare(
          `SELECT u.id, u.email, u.full_name as fullName, u.phone, u.branch_id as branchId,
                  u.mfa_enabled as mfaEnabled, u.is_active as isActive, u.created_at as createdAt,
                  r.code as roleCode, r.name as roleName, b.name as branchName
           FROM users u
           JOIN roles r ON r.id = u.role_id
           LEFT JOIN branches b ON b.id = u.branch_id
           ORDER BY u.id DESC`
        )
        .all();

  const roles = db
    .prepare('SELECT id, code, name, description FROM roles ORDER BY id ASC')
    .all() as Array<{ id: number; code: string; name: string; description: string }>;

  const rolesWithPerms = roles.map((r) => {
    const perms = db
      .prepare('SELECT permission FROM role_permissions WHERE role_id = ?')
      .all(r.id) as Array<{ permission: string }>;
    return { ...r, permissions: perms.map((p) => p.permission) };
  });

  res.json({ users, roles: rolesWithPerms, allPermissions: Object.values(Permission) });
});

authAdminRouter.post('/users', requirePermission(Permission.USER_MANAGE), (req, res) => {
  const schema = z.object({
    fullName: z.string().min(2),
    email: z.string().email(),
    phone: z.string().min(6),
    password: z.string().min(8),
    roleCode: z.nativeEnum(RoleCode),
    branchId: z.number().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const d = parsed.data;
  if (d.roleCode === RoleCode.SUPER_ADMIN && req.authUser!.roleCode !== RoleCode.SUPER_ADMIN) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Only Super Administrators can assign Super Administrator role.' });
    return;
  }
  const scope = resolveScopedBranchId(req.authUser!, d.branchId);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Cannot create user in unauthorized branch.' });
    return;
  }

  const db = getDb();
  const roleRow = db.prepare('SELECT id FROM roles WHERE code = ?').get(d.roleCode) as { id: number };
  try {
    const info = db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, phone, role_id, branch_id, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
      )
      .run(
        d.email.trim().toLowerCase(),
        hashPassword(d.password),
        d.fullName.trim(),
        d.phone.trim(),
        roleRow.id,
        scope.branchId,
        new Date().toISOString()
      );
    const id = Number(info.lastInsertRowid);
    writeAuditLog({
      actor: req.authUser!,
      branchId: scope.branchId,
      action: 'USER_CREATED',
      entityType: 'users',
      entityId: id,
      after: { email: d.email, roleCode: d.roleCode, branchId: scope.branchId },
    });
    res.status(201).json({ id });
  } catch {
    res.status(409).json({ error: 'CONFLICT', message: 'Email address is already registered.' });
  }
});

authAdminRouter.patch('/users/:id/status', requirePermission(Permission.USER_MANAGE), (req, res) => {
  const userId = Number(req.params.id);
  const isActive = Boolean(req.body?.isActive);
  if (userId === req.authUser!.id && !isActive) {
    res.status(400).json({ error: 'INVALID_OPERATION', message: 'You cannot deactivate your own active account.' });
    return;
  }
  const db = getDb();
  const existing = db.prepare('SELECT id, branch_id, is_active FROM users WHERE id = ?').get(userId) as
    | { id: number; branch_id: number | null; is_active: number }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
    return;
  }
  const scope = resolveScopedBranchId(req.authUser!, existing.branch_id);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Branch restriction prevents modifying this user.' });
    return;
  }
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, userId);
  if (!isActive) {
    db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ?').run(
      new Date().toISOString(),
      userId
    );
  }
  writeAuditLog({
    actor: req.authUser!,
    branchId: existing.branch_id,
    action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
    entityType: 'users',
    entityId: userId,
    before: { isActive: Boolean(existing.is_active) },
    after: { isActive },
  });
  res.json({ ok: true });
});

authAdminRouter.put('/roles/:roleCode/permissions', requirePermission(Permission.ROLE_MANAGE), (req, res) => {
  const roleCode = req.params.roleCode as RoleCode;
  if (roleCode === RoleCode.SUPER_ADMIN) {
    res.status(400).json({ error: 'PROTECTED_ROLE', message: 'Super Administrator permissions cannot be stripped.' });
    return;
  }
  const schema = z.object({
    permissions: z.array(z.nativeEnum(Permission)),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid permission list.' });
    return;
  }
  const db = getDb();
  const role = db.prepare('SELECT id FROM roles WHERE code = ?').get(roleCode) as { id: number } | undefined;
  if (!role) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Role not found.' });
    return;
  }
  const before = db
    .prepare('SELECT permission FROM role_permissions WHERE role_id = ?')
    .all(role.id) as Array<{ permission: string }>;

  db.transaction(() => {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(role.id);
    const ins = db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)');
    for (const p of parsed.data.permissions) {
      ins.run(role.id, p);
    }
  })();

  writeAuditLog({
    actor: req.authUser!,
    action: 'ROLE_PERMISSIONS_UPDATED',
    entityType: 'roles',
    entityId: roleCode,
    before: before.map((b) => b.permission),
    after: parsed.data.permissions,
  });

  res.json({ ok: true });
});

// ======================== AUDIT LOGS & DATABASE BACKUPS ========================
authAdminRouter.get('/audit-logs', requirePermission(Permission.AUDIT_VIEW), (req, res) => {
  const scope = resolveScopedBranchId(req.authUser!, req.query.branchId as string | undefined);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Branch restriction prevents viewing audit logs.' });
    return;
  }
  const limit = Math.min(200, Math.max(10, Number(req.query.limit || 80)));
  const search = String(req.query.search || '').trim();
  const db = getDb();

  let sql = `
    SELECT id, actor_user_id as actorUserId, actor_name as actorName, actor_role as actorRole,
           branch_id as branchId, action, entity_type as entityType, entity_id as entityId,
           before_json as beforeJson, after_json as afterJson, outcome, correlation_id as correlationId,
           created_at as createdAt
    FROM audit_logs
    WHERE 1=1
  `;
  const params: Array<string | number> = [];
  if (scope.branchId !== null) {
    sql += ' AND branch_id = ?';
    params.push(scope.branchId);
  }
  if (search) {
    sql += ' AND (action LIKE ? OR actor_name LIKE ? OR entity_type LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);

  const logs = db.prepare(sql).all(...params);
  res.json({ logs });
});

authAdminRouter.get('/backups', requirePermission(Permission.BACKUP_MANAGE), (_req, res) => {
  const backupDir = path.resolve(process.cwd(), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.endsWith('.sqlite.bak'))
    .map((f) => {
      const stat = fs.statSync(path.join(backupDir, f));
      return {
        filename: f,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ backups: files });
});

authAdminRouter.post('/backups/create', requirePermission(Permission.BACKUP_MANAGE), async (req, res) => {
  const backupDir = path.resolve(process.cwd(), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `ims-backup-${stamp}.sqlite.bak`;
  const dest = path.join(backupDir, filename);
  const db = getDb();
  await db.backup(dest);
  writeAuditLog({
    actor: req.authUser!,
    action: 'DATABASE_BACKUP_CREATED',
    entityType: 'backups',
    entityId: filename,
  });
  res.status(201).json({ ok: true, filename });
});

authAdminRouter.post('/backups/restore', requirePermission(Permission.BACKUP_MANAGE), (req, res) => {
  const filename = String(req.body?.filename || '').trim();
  if (!filename || filename.includes('..') || filename.includes('/') || !filename.endsWith('.sqlite.bak')) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid backup filename.' });
    return;
  }
  const backupPath = path.resolve(process.cwd(), 'backups', filename);
  if (!fs.existsSync(backupPath)) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Backup snapshot file does not exist.' });
    return;
  }
  const targetDbPath = getDbPath();
  closeAndResetDbInstance();
  fs.copyFileSync(backupPath, targetDbPath);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(targetDbPath + suffix)) {
      fs.unlinkSync(targetDbPath + suffix);
    }
  }
  ensureSeedData();
  writeAuditLog({
    actor: req.authUser!,
    action: 'DATABASE_BACKUP_RESTORED',
    entityType: 'backups',
    entityId: filename,
  });
  res.json({ ok: true, message: `Database restored cleanly from ${filename}.` });
});
