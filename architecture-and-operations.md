# IMS Architecture, Security, API & Operations Manual

## 1. System Architecture Overview

The **Institute Management System (IMS)** follows a strict three-tier modular architecture:

1. **Presentation Layer (`/src/pages`, `/src/components`, `/src/context`)**:
   - Accessible React 19 + TypeScript single-page application using Tailwind CSS v4, TanStack Query v5 for server cache invalidation, and Recharts for operational analytics.
   - Zero client-only authorization trust: UI navigation adapts to `user.permissions`, while every REST endpoint independently enforces role permissions, branch ownership, teacher assignment, and guardian-child linkage.
2. **Domain & Validation Layer (`/src/shared/domain-logic.ts`, Zod schemas)**:
   - Pure, deterministic functions handle integer-paise monetary calculations, FIFO fee installment allocation, teacher payroll computation, syllabus topic deduplication, exam grading, and timetable room/teacher overlap detection.
3. **API & Persistence Layer (`/src/server`)**:
   - Express REST API (`createApiApp()`) with centralized authentication, CSRF verification, structured JSON error handling, immutable audit logging (`audit_logs`), and online backup/restoration.
   - Relational SQLite (`better-sqlite3` with WAL mode and `FOREIGN KEYS = ON`) for hermetic single-instance reliability, paired with canonical MySQL 8 DDL (`/database/schema.mysql.sql`) and Prisma schema (`/database/schema.prisma`) for distributed deployments.

---

## 2. Database Design & Integrity Guarantees

The schema comprises **31 normalized tables** grouped into 7 domains:

- **Identity & Access**: `branches`, `roles`, `role_permissions`, `users`, `user_branch_access`, `auth_sessions`, `password_resets`, `login_attempts`.
- **People**: `salary_structures`, `teachers`, `students`, `guardians`, `student_guardians`.
- **Academics**: `courses`, `subjects`, `syllabus_topics`, `batches`, `batch_teachers`, `enrolments`, `timetable_slots`, `class_sessions`, `teaching_records`, `batch_topic_progress`.
- **Attendance & Leave**: `student_attendance`, `student_movements`, `teacher_verification_challenges`, `teacher_attendance`, `leave_requests`, `holidays`.
- **Finance & Payroll**: `fee_assessments`, `payments`, `payment_allocations`, `payroll_runs`, `payroll_items`.
- **Assessments & Homework**: `examinations`, `exam_results`, `homework_assignments`, `homework_submissions`.
- **Governance & Comms**: `notifications`, `audit_logs`, `schema_migrations`.

### Critical Data Invariants
- **Exact Monetary Storage**: All monetary columns (`*_paise`) store integer paise (`₹1.00 = 100 paise`). No floating-point (`FLOAT`/`DOUBLE`) columns exist anywhere in fee or payroll tables.
- **No Destructive Financial Deletes**: Fee payments cannot be deleted; `POST /api/payments/:id/reverse` marks `status = 'REVERSED'`, records `reversed_by_user_id` and `reversal_reason`, and recomputes FIFO balance allocations inside a single transaction.
- **Classroom Attendance vs. Campus Gate Separation**: `student_movements` records physical campus entry/exit times and flags missing exits; it **never** auto-marks `student_attendance` for academic sessions.
- **Explicit Teaching Record Completion**: `class_sessions` remain `SCHEDULED` until an assigned/substitute teacher or authorized administrator submits a `teaching_records` entry.

---

## 3. Security Architecture

- **Password Storage**: `crypto.scryptSync` (`N=16384, r=8, p=1`, 64-byte derived key, 16-byte random salt) verified via `crypto.timingSafeEqual`.
- **Teacher Verification Challenges**: Plaintext challenge codes are returned **once** to the authorized issuing host (`POST /api/teacher-attendance/challenges`) and stored exclusively as salted `HMAC-SHA256` digests (`secret_hash`). Replay, expired, revoked, cross-branch, and wrong-teacher submissions are rejected and logged.
- **Brute-Force & Account Lockout**: Tracks per-IP velocity (`login_attempts`) and per-account `failed_login_count`, locking accounts for 15 minutes after 5 consecutive failures.
- **Session & CSRF Protection**: Supports `HttpOnly`, `SameSite=Lax` (`Secure` in production) cookies with `X-CSRF-Token` validation on mutating cookie-authenticated requests, as well as `Authorization: Bearer` tokens for embedded cross-origin preview frames.
- **Audit Log Protection**: `writeAuditLog()` automatically redacts sensitive keys (`password`, `secret`, `token`, `pin`, `hash`) from serialized `before_json` / `after_json` payloads. No API endpoint permits editing or deleting `audit_logs`.

---

## 4. Environment Variables Reference

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | Yes | `development` | Set to `production` to disable demo seed accounts & enable `Secure` cookies |
| `DATABASE_PATH` | No | `./data/ims.sqlite` | Path to persistent SQLite database file |
| `DATABASE_URL` | MySQL only | — | MySQL connection string when using Prisma (`mysql://user:pass@host:3306/db`) |
| `SESSION_TTL_HOURS` | No | `12` | Session validity window in hours |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Optional | — | Enables `LIVE` email dispatch; when unset, notifications log honestly as `DEV_SANDBOX` |
| `SMS_PROVIDER_API_KEY` | Optional | — | Enables external SMS adapter |
| `WHATSAPP_PROVIDER_API_KEY` | Optional | — | Enables external WhatsApp adapter |

---

## 5. REST API Reference Summary

Machine-readable OpenAPI 3.1 JSON is served live at `GET /api/openapi.json`.

- **Auth & Governance**:
  - `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/revoke-all-sessions`, `POST /api/auth/mfa-toggle`
  - `POST /api/auth/password-reset/request`, `POST /api/auth/password-reset/confirm`
  - `GET|POST /api/branches`, `PATCH /api/branches/:id`
  - `GET|POST /api/users`, `PATCH /api/users/:id/status`, `GET /api/roles`, `PUT /api/roles/:code/permissions`
  - `GET /api/audit-logs`, `GET /api/backups`, `POST /api/backups/create`, `POST /api/backups/restore`
- **People**:
  - `GET|POST /api/students`, `PATCH /api/students/:id/status`
  - `GET|POST /api/teachers`, `PATCH /api/teachers/:id`
- **Academics, Examinations & Homework**:
  - `GET /api/academics/overview`, `POST /api/courses`, `POST /api/subjects/:id/topics`, `POST /api/batches`, `POST /api/timetable-slots`
  - `GET|POST /api/class-sessions`, `PATCH /api/class-sessions/:id/substitute-or-status`, `GET|POST /api/teaching-records`
  - `GET|POST /api/examinations`, `POST /api/examinations/:id/results`
  - `GET|POST /api/homework`, `POST /api/homework/:id/submissions`
- **Attendance & Leave**:
  - `GET|POST /api/student-attendance/session/:sessionId`
  - `GET /api/student-movements`, `POST /api/student-movements/entry`, `POST /api/student-movements/:id/exit`, `POST /api/student-movements/:id/exception`
  - `GET /api/teacher-attendance`, `POST /api/teacher-attendance/challenges`, `POST /api/teacher-attendance/challenges/:id/revoke`, `POST /api/teacher-attendance/check-in`, `POST /api/teacher-attendance/check-out`, `POST /api/teacher-attendance/override`
  - `GET|POST /api/leave-requests`, `PATCH /api/leave-requests/:id/review`, `GET|POST /api/holidays`
- **Finance, Payroll, Portals & Reports**:
  - `GET /api/fees/ledger`, `POST /api/fees/assessments`, `PATCH /api/fees/assessments/:id/adjust`, `POST /api/payments`, `POST /api/payments/:id/reverse`
  - `GET /api/payroll`, `POST /api/payroll/calculate`, `POST /api/payroll/:id/approve`, `POST /api/payroll/items/:itemId/disburse`
  - `GET /api/dashboard`, `GET /api/portal/student`, `GET /api/portal/parent`, `GET|POST /api/notifications`
  - `GET /api/reports/daily-teaching`, `GET /api/reports/export/:reportType`

---

## 6. Database Backup & Restoration Procedure

1. **Online Snapshot Creation**:
   - Via UI: Navigate to **Administration -> Database Backups** (`SUPER_ADMIN`) and click **Create Online Backup Snapshot**.
   - Via API: `POST /api/backups/create` invokes SQLite's hot backup API (`db.backup(...)`) to write a consistent `.sqlite.bak` file in `/backups/` without locking active readers, recording `DATABASE_BACKUP_CREATED` in `audit_logs`.
2. **Verified Restoration**:
   - Via UI or `POST /api/backups/restore` (`{ "filename": "ims-backup-....sqlite.bak" }`): Safely closes active file handles, replaces the database file, clears stale `-wal`/`-shm` journals, re-opens the connection, and logs `DATABASE_BACKUP_RESTORED`.
   - For MySQL 8 deployments: Run `mysqldump --single-transaction --routines --triggers ims_production > backup.sql` on a scheduled cron job and verify restoration into a staging schema weekly.

---

## 7. Known Operational Boundaries & Future Enhancements

- **External Messaging Providers**: Email/SMS/WhatsApp dispatches run in transparent `DEV_SANDBOX` mode unless `SMTP_HOST`, `SMS_PROVIDER_API_KEY`, or `WHATSAPP_PROVIDER_API_KEY` are supplied in `.env`. No fake external delivery success is ever claimed.
- **Document Attachments**: Student/teacher document metadata and homework submission text notes are stored directly in the relational database; binary S3/object-storage upload adapters can be attached for large PDF/video coursework archives.
