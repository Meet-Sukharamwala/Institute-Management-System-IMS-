import { getDb } from './db';
import { hashPassword, hashVerificationSecret } from './crypto';
import { DEFAULT_ROLE_PERMISSIONS, RoleCode } from '../shared/types';

export const DEV_SAMPLE_PASSWORD = 'Ims@2026!Secure';

export function ensureSeedData(): void {
  const db = getDb();

  // Always seed canonical roles & permissions idempotently
  const roleDescriptions: Record<RoleCode, { name: string; desc: string }> = {
    [RoleCode.SUPER_ADMIN]: {
      name: 'Super Administrator',
      desc: 'Institute-wide governance across all branches, payroll approval, security, and backups.',
    },
    [RoleCode.BRANCH_ADMIN]: {
      name: 'Branch Administrator',
      desc: 'Operational management restricted strictly to the assigned branch.',
    },
    [RoleCode.TEACHER]: {
      name: 'Teacher / Faculty',
      desc: 'Daily verification check-in, classroom attendance, syllabus teaching records, exams, and homework.',
    },
    [RoleCode.ACCOUNTANT]: {
      name: 'Accountant',
      desc: 'Student fee ledgers, receipts, discounts, refunds, and draft payroll preparation.',
    },
    [RoleCode.RECEPTIONIST]: {
      name: 'Receptionist / Front Desk',
      desc: 'Student admissions, campus entry/exit tracking, host challenge display, and fee collection.',
    },
    [RoleCode.STUDENT]: {
      name: 'Student',
      desc: 'Student portal access to own timetable, attendance, homework, exams, and fee receipts.',
    },
    [RoleCode.PARENT]: {
      name: 'Parent / Guardian',
      desc: 'Guardian portal access strictly restricted to linked children records.',
    },
  };

  for (const code of Object.values(RoleCode)) {
    const existing = db.prepare('SELECT id FROM roles WHERE code = ?').get(code) as
      | { id: number }
      | undefined;
    let roleId: number;
    if (!existing) {
      const res = db
        .prepare('INSERT INTO roles (code, name, description) VALUES (?, ?, ?)')
        .run(code, roleDescriptions[code].name, roleDescriptions[code].desc);
      roleId = Number(res.lastInsertRowid);
    } else {
      roleId = existing.id;
    }

    const perms = DEFAULT_ROLE_PERMISSIONS[code] || [];
    const insertPerm = db.prepare(
      'INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)'
    );
    for (const p of perms) {
      insertPerm.run(roleId, p);
    }
  }

  // In production mode, never auto-seed if branches exist
  if (process.env.NODE_ENV === 'production' && process.env.IMS_SEED_DEMO !== 'true') {
    const branchCount = (db.prepare('SELECT COUNT(*) as c FROM branches').get() as { c: number }).c;
    if (branchCount > 0) return;
    if (process.env.DISABLE_DEMO_SEED === 'true') return;
  }

  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount > 0) return;

  const nowIso = new Date().toISOString();
  const sharedHash = hashPassword(DEV_SAMPLE_PASSWORD);
  const mfaPinHash = hashVerificationSecret('246810', 'mfa-static-salt');

  const getRoleId = (code: RoleCode) =>
    (db.prepare('SELECT id FROM roles WHERE code = ?').get(code) as { id: number }).id;

  const seedTx = db.transaction(() => {
    // 1. Initial Academy Branches
    const b1 = Number(
      db
        .prepare(
          `INSERT INTO branches (code, name, city, address, phone, email, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .run(
          'PUN-KOT',
          'NIKEN ACADEMY — Main Campus',
          'Pune',
          'Plot 42, Paud Road, Kothrud, Pune, Maharashtra 411038',
          '+91-20-25431100',
          'kothrud@nikenacademy.edu.in',
          nowIso
        ).lastInsertRowid
    );

    db.prepare(
      `INSERT INTO branches (code, name, city, address, phone, email, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      'PUN-VIM',
      'NIKEN ACADEMY — Viman Nagar Branch',
      'Pune',
      '2nd Floor, Symbiosis Road, Viman Nagar, Pune, Maharashtra 411014',
      '+91-20-26634400',
      'vimannagar@nikenacademy.edu.in',
      nowIso
    );

    // 2. Sole Initial Administrative User: Academy Director
    const superAdminUserId = Number(
      db
        .prepare(
          `INSERT INTO users (email, password_hash, full_name, phone, role_id, branch_id, mfa_enabled, mfa_pin_hash, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, 0, ?, 1, ?)`
        )
        .run(
          'director@nikenacademy.edu.in',
          sharedHash,
          'Niken Patel',
          '+91-9822011001',
          getRoleId(RoleCode.SUPER_ADMIN),
          mfaPinHash,
          nowIso
        ).lastInsertRowid
    );

    // 3. Faculty Salary Structure Templates (reusable when adding new faculty)
    db.prepare(
      `INSERT INTO salary_structures (name, model, base_salary_paise, per_lecture_rate_paise, hourly_rate_paise, allowances_paise, statutory_deduction_paise, deduct_unpaid_leave, created_at)
       VALUES (?, 'FIXED_MONTHLY', 7500000, 150000, 0, 800000, 240000, 1, ?)`
    ).run('Senior Faculty Monthly Grade-A', nowIso);

    db.prepare(
      `INSERT INTO salary_structures (name, model, base_salary_paise, per_lecture_rate_paise, hourly_rate_paise, allowances_paise, statutory_deduction_paise, deduct_unpaid_leave, created_at)
       VALUES (?, 'PER_LECTURE', 0, 180000, 0, 200000, 20000, 0, ?)`
    ).run('Visiting Subject Specialist (Per-Lecture)', nowIso);

    // 4. Initial System Initialization Audit Entry
    db.prepare(
      `INSERT INTO audit_logs (actor_user_id, actor_name, actor_role, branch_id, action, entity_type, entity_id, before_json, after_json, outcome, correlation_id, created_at)
       VALUES (?, 'Niken Patel', 'SUPER_ADMIN', ?, 'SYSTEM_INITIALIZED', 'system', 'niken-academy-bootstrap', NULL, '{"status":"READY","mode":"CLEAN_BOOTSTRAP"}', 'SUCCESS', 'init-bootstrap-001', ?)`
    ).run(superAdminUserId, b1, nowIso);
  });

  seedTx();
}
