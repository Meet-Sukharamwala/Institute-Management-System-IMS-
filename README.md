# Institute Management System (IMS)

Production-oriented **Educational Institute Operations & Academic Management Web Application** designed for multi-branch Indian coaching academies, tuition institutes, and academic campuses.

---

## 1. Key Capabilities

- **Multi-Branch & Granular RBAC**: 7 initial roles (`SUPER_ADMIN`, `BRANCH_ADMIN`, `TEACHER`, `ACCOUNTANT`, `RECEPTIONIST`, `STUDENT`, `PARENT`) backed by 28 configurable database-persisted permissions and strict server-side branch isolation.
- **Hardened Authentication**: Memory-hard `scrypt` password hashing with cryptographic salts and constant-time verification, `HttpOnly` + Bearer session support, CSRF token verification, IP login rate-limiting + account lockout, session revocation, password reset tokens, and optional 6-digit MFA PIN protection for privileged accounts.
- **Operational Executive Dashboard**: Date- and branch-filtered KPIs across Students, Faculty, Academics, and Finance, batch enrollment/attendance charts, actionable operational alerts, and live audit feed.
- **Student Lifecycle & Admission Workflow**: Atomic student admission creating student profile, guardian link, batch enrolment, composite fee assessment, and optional initial payment receipt in a single database transaction.
- **Academic & Deduplicated Syllabus Tracking**: Courses, subjects, ordered chapter/topic syllabus plans, conflict-checked timetable & session scheduling, substitution management, and daily teaching records that never auto-complete without explicit teacher submission.
- **Dual Student Attendance vs. Campus Movement Logs**:
  - **Classroom Session Attendance**: Per-session roster marking (`PRESENT`, `ABSENT`, `LATE`, `APPROVED_LEAVE`) with audited override reasons required for historical edits.
  - **Campus Entry/Exit Logs**: Independent physical gate movement tracking (`STAFF_DESK`, `QR_BADGE`, `RFID_GATE`) with missing-exit exception flagging—never conflated with classroom attendance.
- **Strict Teacher Attendance Verification**: Authorized host generates short-lived HMAC-SHA256 verification challenges (`SINGLE_USE_GLOBAL` or `PER_TEACHER_DAILY`); server-side clock stamps check-in and check-out durations; manual overrides require audited reasons.
- **Transaction-Safe Fee Ledger**: Exact integer paise (`₹1.00 = 100 paise`) arithmetic, FIFO installment/obligation allocation, idempotency-key duplicate payment protection, printable fee receipts, and non-destructive payment reversals.
- **Restricted Salary & Payroll Engine**: Fixed monthly, per-lecture, and hourly salary structures integrated with verified teacher attendance, completed lectures, and paid/unpaid leave policies; draft calculation -> approval gate -> UTR disbursement; strict own-payslip isolation for faculty.
- **Examinations, Homework, Portals, Notifications & Backups**: Indian grading scale (`A1`–`E`), homework assignments & submissions, dedicated Student and Parent portals (with guardian-child link enforcement), honest `DEV_SANDBOX` vs `LIVE` notification adapters, audited CSV/Excel exports, and online database backup & restoration.

---

## 2. Architectural Note (Database & Runtime Stack)

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4 + React Router v7 + TanStack Query v5 + Recharts + Zod.
- **Backend & Persistence**:
  - To run self-contained with zero external daemon dependencies inside standalone/containerized preview environments, the active runtime uses **Express + TypeScript (`tsx server.ts`)** backed by a normalized 31-table **SQLite (`better-sqlite3`)** relational engine configured with `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, version-controlled schema migrations (`schema_migrations`), and ACID transactions (`db.transaction(...)`).
  - For enterprise multi-node deployments requiring MySQL 8 + Prisma, canonical MySQL 8 DDL (`/database/schema.mysql.sql`), Prisma schema (`/database/schema.prisma`), and `docker-compose.yml` are included in the repository.

---

## 3. Project Structure

```text
/
├── database/
│   ├── schema.mysql.sql          # Canonical MySQL 8.0+ relational DDL
│   └── schema.prisma             # Prisma ORM schema for MySQL deployments
├── docs/
│   └── architecture-and-operations.md # Full architecture, API, security & ops manual
├── scripts/
│   └── bootstrap-admin.ts        # Production CLI script to initialize first SUPER_ADMIN
├── src/
│   ├── shared/
│   │   ├── types.ts              # Shared RoleCode, Permission enum & DTO contracts
│   │   ├── domain-logic.ts       # Pure financial, payroll, syllabus & RBAC math
│   │   └── domain-logic.test.ts  # Fast deterministic unit tests (node:test)
│   ├── server/
│   │   ├── app.ts                # Express REST API & OpenAPI 3.1 spec (/api/openapi.json)
│   │   ├── db.ts                 # 31-table relational schema & versioned migrations
│   │   ├── crypto.ts             # Scrypt password hashing & HMAC challenge verification
│   │   ├── auth.ts               # Session, CSRF, RBAC & branch isolation middleware
│   │   ├── audit.ts              # Sensitive-field-scrubbing immutable audit logger
│   │   ├── notifications.ts      # Multi-channel notification adapter (LIVE / DEV_SANDBOX)
│   │   ├── seed.ts               # Development multi-branch seed (disabled in production)
│   │   ├── api-integration.test.ts # End-to-end API, security & backup/restore tests
│   │   └── routes/               # Modular controllers (auth-admin, people, academics, attendance, finance, portals-reports)
│   ├── components/               # Reusable accessible UI primitives & responsive AppLayout
│   ├── context/                  # Auth session, branch switcher & toast context
│   └── pages/                    # 18 modular role-aware operational screens
├── server.ts                     # Unified Express + Vite/Static full-stack entrypoint
├── docker-compose.yml            # Containerized MySQL 8 + IMS service orchestration
└── .env.example                  # Documented environment variable template
```

---

## 4. Quick Start & Commands

### Prerequisites
- Node.js 20+ and npm.

### 1. Install Dependencies & Configure Environment
```bash
npm install
cp .env.example .env
```

### 2. Start Full-Stack Development Server (Port 3000)
Automatically runs database migrations and seeds the fictional **NIKEN ACADEMY** dataset (Kothrud & Viman Nagar branches) when `NODE_ENV !== 'production'`:
```bash
npm run dev
```

### 3. Run Automated Unit, Integration, Security & Backup/Restore Tests
```bash
npm test
```

### 4. Type-Check & Build Production Assets
```bash
npm run lint
npm run build
```

### 5. First-Time Production Onboarding (No Hardcoded Default Admin)
When `NODE_ENV=production`, demo accounts are **never** seeded. Provision your initial Super Administrator via CLI:
```bash
NODE_ENV=production \
IMS_BOOTSTRAP_NAME="Dr. Meera Deshmukh" \
IMS_BOOTSTRAP_EMAIL="admin@yourinstitute.edu.in" \
IMS_BOOTSTRAP_PASSWORD="ReplaceWithStrongPassword#2026" \
IMS_BRANCH_CODE="MAIN-01" \
IMS_BRANCH_NAME="Main Campus" \
IMS_BRANCH_CITY="Pune" \
npm run bootstrap:admin

npm run start
```

---

## 5. Development Demo Accounts (`NODE_ENV=development` Only)

All development demo accounts share the password `Ims@2026!Secure` (also selectable via the one-click Sandbox Role Quick-Fill on the Login screen):

| Role | Email | Scope |
| :--- | :--- | :--- |
| **Super Administrator** | `director@nikenacademy.edu.in` | All Branches |
| **Branch Admin (Kothrud)** | `kothrud.admin@nikenacademy.edu.in` | Branch 1 (`PUN-KOT`) |
| **Branch Admin (Viman Nagar)** | `viman.admin@nikenacademy.edu.in` | Branch 2 (`PUN-VIM`) |
| **Accountant** | `accounts@nikenacademy.edu.in` | Branch 1 Fees & Payroll |
| **Receptionist** | `frontdesk@nikenacademy.edu.in` | Branch 1 Admissions & Gate Logs |
| **Teacher (Physics)** | `raghav.physics@nikenacademy.edu.in` | Branch 1 Classes & Own Payslips |
| **Teacher (Mathematics)** | `ananya.math@nikenacademy.edu.in` | Branch 1 Classes & Check-In |
| **Teacher (Chemistry)** | `vikram.chem@nikenacademy.edu.in` | Branch 2 Classes & Check-In |
| **Student** | `aarav.sharma@student.nikenacademy.edu.in` | Student Self-Service Portal |
| **Parent / Guardian** | `rajesh.sharma@parent.nikenacademy.edu.in` | Linked Child (`STU-2026-001`) |

For complete architecture, database ER details, security controls, backup/restore procedures, and API endpoints, see [`docs/architecture-and-operations.md`](docs/architecture-and-operations.md).
