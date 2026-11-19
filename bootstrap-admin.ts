import 'dotenv/config';
import { getDb } from '../src/server/db';
import { ensureSeedData } from '../src/server/seed';
import { hashPassword } from '../src/server/crypto';
import { RoleCode } from '../src/shared/types';

/**
 * Production Initial Super Administrator Bootstrap CLI
 *
 * Usage:
 *   IMS_BOOTSTRAP_NAME="Dr. Meera Deshmukh" \
 *   IMS_BOOTSTRAP_EMAIL="admin@yourinstitute.edu.in" \
 *   IMS_BOOTSTRAP_PASSWORD="StrongUniquePassword#2026" \
 *   IMS_BRANCH_CODE="MAIN-01" \
 *   IMS_BRANCH_NAME="Main Campus" \
 *   IMS_BRANCH_CITY="Pune" \
 *   npm run bootstrap:admin
 */
function main() {
  const fullName = (process.env.IMS_BOOTSTRAP_NAME || '').trim();
  const email = (process.env.IMS_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
  const password = process.env.IMS_BOOTSTRAP_PASSWORD || '';
  const branchCode = (process.env.IMS_BRANCH_CODE || 'HQ-01').trim().toUpperCase();
  const branchName = (process.env.IMS_BRANCH_NAME || 'Headquarters Campus').trim();
  const branchCity = (process.env.IMS_BRANCH_CITY || 'Pune').trim();

  if (!fullName || !email || password.length < 12) {
    console.error(
      'Bootstrap aborted: Provide IMS_BOOTSTRAP_NAME, IMS_BOOTSTRAP_EMAIL, and IMS_BOOTSTRAP_PASSWORD (minimum 12 characters).'
    );
    process.exit(1);
  }

  const db = getDb();
  // Ensure roles and permissions exist without creating demo accounts in production
  ensureSeedData();

  const existingSuperAdmin = db
    .prepare(
      `SELECT u.id, u.email FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.code = ? LIMIT 1`
    )
    .get(RoleCode.SUPER_ADMIN) as { id: number; email: string } | undefined;

  if (existingSuperAdmin) {
    console.error(
      `Bootstrap refused: A SUPER_ADMIN account (${existingSuperAdmin.email}) already exists. Sign in via the administrative UI to manage users.`
    );
    process.exit(1);
  }

  const superRole = db.prepare('SELECT id FROM roles WHERE code = ?').get(RoleCode.SUPER_ADMIN) as
    | { id: number }
    | undefined;
  if (!superRole) {
    console.error('Bootstrap failed: Role definitions were not initialized.');
    process.exit(1);
  }

  const nowIso = new Date().toISOString();
  const passwordHash = hashPassword(password);

  db.transaction(() => {
    let branchRow = db.prepare('SELECT id FROM branches WHERE code = ?').get(branchCode) as
      | { id: number }
      | undefined;
    if (!branchRow) {
      const bInfo = db
        .prepare(
          `INSERT INTO branches (code, name, city, state, address, phone, email, is_active, created_at)
           VALUES (?, ?, ?, 'Maharashtra', 'Primary Institutional Campus', '', ?, 1, ?)`
        )
        .run(branchCode, branchName, branchCity, email, nowIso);
      branchRow = { id: Number(bInfo.lastInsertRowid) };
    }

    const uInfo = db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, phone, role_id, primary_branch_id, is_active, mfa_enabled, created_at)
         VALUES (?, ?, ?, '', ?, ?, 1, 0, ?)`
      )
      .run(email, passwordHash, fullName, superRole.id, branchRow.id, nowIso);

    db.prepare(
      `INSERT INTO audit_logs (actor_user_id, actor_name, actor_role, branch_id, action, entity_type, entity_id, outcome, correlation_id, created_at)
       VALUES (?, ?, 'SUPER_ADMIN', ?, 'PRODUCTION_SUPER_ADMIN_BOOTSTRAPPED', 'users', ?, 'SUCCESS', 'cli-bootstrap', ?)`
    ).run(Number(uInfo.lastInsertRowid), fullName, branchRow.id, String(uInfo.lastInsertRowid), nowIso);
  })();

  console.log(`Initial SUPER_ADMIN (${email}) and campus (${branchCode}) provisioned cleanly.`);
}

main();
