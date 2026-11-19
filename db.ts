import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

let dbInstance: Database.Database | null = null;

export function getDbPath(): string {
  if (process.env.DATABASE_PATH) {
    return path.resolve(process.cwd(), process.env.DATABASE_PATH);
  }
  return path.resolve(process.cwd(), 'data', 'ims.sqlite');
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  dbInstance = db;
  return db;
}

export function closeAndResetDbInstance(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = db
    .prepare('SELECT version FROM schema_migrations WHERE version = ?')
    .get('001_initial_ims_schema');

  if (applied) return;

  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE branches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        city TEXT NOT NULL,
        address TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL
      );

      CREATE TABLE role_permissions (
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission TEXT NOT NULL,
        PRIMARY KEY (role_id, permission)
      );

      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        role_id INTEGER NOT NULL REFERENCES roles(id),
        branch_id INTEGER REFERENCES branches(id),
        mfa_enabled INTEGER NOT NULL DEFAULT 0,
        mfa_pin_hash TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        failed_login_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until_ms INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_users_branch ON users(branch_id);
      CREATE INDEX idx_users_role ON users(role_id);

      CREATE TABLE auth_sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        expires_at_ms INTEGER NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_user ON auth_sessions(user_id);

      CREATE TABLE password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE salary_structures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        model TEXT NOT NULL,
        base_salary_paise INTEGER NOT NULL DEFAULT 0,
        per_lecture_rate_paise INTEGER NOT NULL DEFAULT 0,
        hourly_rate_paise INTEGER NOT NULL DEFAULT 0,
        allowances_paise INTEGER NOT NULL DEFAULT 0,
        statutory_deduction_paise INTEGER NOT NULL DEFAULT 0,
        deduct_unpaid_leave INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE teachers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_code TEXT NOT NULL UNIQUE,
        user_id INTEGER UNIQUE REFERENCES users(id),
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        designation TEXT NOT NULL,
        employment_type TEXT NOT NULL,
        joining_date TEXT NOT NULL,
        primary_branch_id INTEGER NOT NULL REFERENCES branches(id),
        subjects_csv TEXT NOT NULL DEFAULT '',
        salary_structure_id INTEGER REFERENCES salary_structures(id),
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        documents_notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_teachers_branch ON teachers(primary_branch_id);

      CREATE TABLE teacher_branches (
        teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
        branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        PRIMARY KEY (teacher_id, branch_id)
      );

      CREATE TABLE courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        academic_level TEXT NOT NULL,
        duration_months INTEGER NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        default_fee_paise INTEGER NOT NULL,
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_courses_branch ON courses(branch_id);

      CREATE TABLE subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 1,
        UNIQUE(course_id, code)
      );

      CREATE TABLE syllabus_topics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        chapter_name TEXT NOT NULL,
        topic_title TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 1,
        planned_date TEXT
      );

      CREATE TABLE batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        course_id INTEGER NOT NULL REFERENCES courses(id),
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        classroom TEXT NOT NULL DEFAULT '',
        max_capacity INTEGER NOT NULL DEFAULT 40,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_batches_branch ON batches(branch_id);

      CREATE TABLE batch_teachers (
        batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
        subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        PRIMARY KEY (batch_id, teacher_id, subject_id)
      );

      CREATE TABLE students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_code TEXT NOT NULL UNIQUE,
        user_id INTEGER UNIQUE REFERENCES users(id),
        full_name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL,
        academic_level TEXT NOT NULL,
        admission_date TEXT NOT NULL,
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        enquiry_notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_students_branch ON students(branch_id);
      CREATE INDEX idx_students_status ON students(status);

      CREATE TABLE guardians (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE REFERENCES users(id),
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        relation_type TEXT NOT NULL DEFAULT 'Parent',
        comm_preference TEXT NOT NULL DEFAULT 'IN_APP_EMAIL',
        created_at TEXT NOT NULL
      );

      CREATE TABLE student_guardians (
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        guardian_id INTEGER NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
        is_primary INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (student_id, guardian_id)
      );

      CREATE TABLE enrolments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        enrolled_on TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        UNIQUE(student_id, batch_id)
      );

      CREATE TABLE timetable_slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        subject_id INTEGER NOT NULL REFERENCES subjects(id),
        teacher_id INTEGER NOT NULL REFERENCES teachers(id),
        day_of_week INTEGER NOT NULL, -- 0=Sun..6=Sat
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        classroom TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE class_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_code TEXT NOT NULL UNIQUE,
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        course_id INTEGER NOT NULL REFERENCES courses(id),
        batch_id INTEGER NOT NULL REFERENCES batches(id),
        subject_id INTEGER NOT NULL REFERENCES subjects(id),
        assigned_teacher_id INTEGER NOT NULL REFERENCES teachers(id),
        substitute_teacher_id INTEGER REFERENCES teachers(id),
        conducted_by_teacher_id INTEGER REFERENCES teachers(id),
        session_date TEXT NOT NULL,
        scheduled_start TEXT NOT NULL,
        scheduled_end TEXT NOT NULL,
        classroom TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'SCHEDULED',
        cancellation_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_date_branch ON class_sessions(session_date, branch_id);
      CREATE INDEX idx_sessions_batch ON class_sessions(batch_id);

      CREATE TABLE teaching_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_session_id INTEGER NOT NULL UNIQUE REFERENCES class_sessions(id) ON DELETE CASCADE,
        submitted_by_teacher_id INTEGER NOT NULL REFERENCES teachers(id),
        actual_start TEXT NOT NULL,
        actual_end TEXT NOT NULL,
        chapter_covered TEXT NOT NULL,
        topics_summary TEXT NOT NULL,
        coverage_status TEXT NOT NULL, -- COMPLETED | PARTIALLY_COMPLETED
        homework_assigned TEXT NOT NULL DEFAULT '',
        next_lesson_plan TEXT NOT NULL DEFAULT '',
        student_observations TEXT NOT NULL DEFAULT '',
        remarks TEXT NOT NULL DEFAULT '',
        reviewed_by_user_id INTEGER REFERENCES users(id),
        reviewed_at TEXT,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE batch_topic_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        topic_id INTEGER NOT NULL REFERENCES syllabus_topics(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | PARTIAL | COMPLETED
        completed_on TEXT,
        teaching_record_id INTEGER REFERENCES teaching_records(id),
        UNIQUE(batch_id, topic_id)
      );

      CREATE TABLE student_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_session_id INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        status TEXT NOT NULL, -- PRESENT | ABSENT | LATE | APPROVED_LEAVE
        previous_status TEXT,
        recorded_by_user_id INTEGER NOT NULL REFERENCES users(id),
        correction_reason TEXT NOT NULL DEFAULT '',
        recorded_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(class_session_id, student_id)
      );
      CREATE INDEX idx_student_att_student ON student_attendance(student_id);

      CREATE TABLE student_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        movement_date TEXT NOT NULL,
        entry_time TEXT NOT NULL,
        exit_time TEXT,
        recording_method TEXT NOT NULL DEFAULT 'STAFF_DESK', -- STAFF_DESK | QR_BADGE | RFID_GATE
        recorded_by_user_id INTEGER NOT NULL REFERENCES users(id),
        exception_flag INTEGER NOT NULL DEFAULT 0,
        exception_reason TEXT NOT NULL DEFAULT '',
        resolved_by_user_id INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_movements_date_branch ON student_movements(movement_date, branch_id);

      CREATE TABLE verification_challenges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        challenge_uid TEXT NOT NULL UNIQUE,
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        code_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        display_hint TEXT NOT NULL,
        issued_by_user_id INTEGER NOT NULL REFERENCES users(id),
        applicable_teacher_id INTEGER REFERENCES teachers(id),
        usage_policy TEXT NOT NULL DEFAULT 'ONE_TIME_PER_TEACHER',
        created_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_revoked INTEGER NOT NULL DEFAULT 0,
        revoked_at TEXT,
        consumption_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_challenges_branch ON verification_challenges(branch_id);

      CREATE TABLE verification_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        challenge_id INTEGER REFERENCES verification_challenges(id),
        teacher_id INTEGER NOT NULL REFERENCES teachers(id),
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        succeeded INTEGER NOT NULL,
        failure_reason TEXT NOT NULL DEFAULT '',
        attempted_at_ms INTEGER NOT NULL,
        attempted_at TEXT NOT NULL
      );

      CREATE TABLE teacher_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        attendance_date TEXT NOT NULL,
        challenge_id INTEGER REFERENCES verification_challenges(id),
        check_in_at TEXT NOT NULL,
        check_in_ms INTEGER NOT NULL,
        check_out_at TEXT,
        check_out_ms INTEGER,
        duration_minutes INTEGER,
        verification_method TEXT NOT NULL DEFAULT 'CHALLENGE_CODE',
        status TEXT NOT NULL DEFAULT 'CHECKED_IN', -- CHECKED_IN | CHECKED_OUT | EXCEPTION_FLAGGED | MANUAL_OVERRIDE
        override_reason TEXT NOT NULL DEFAULT '',
        overridden_by_user_id INTEGER REFERENCES users(id),
        UNIQUE(teacher_id, attendance_date)
      );
      CREATE INDEX idx_teacher_att_date_branch ON teacher_attendance(attendance_date, branch_id);

      CREATE TABLE holidays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        branch_id INTEGER REFERENCES branches(id), -- NULL = all branches
        holiday_date TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE leave_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        applicant_type TEXT NOT NULL, -- TEACHER | STUDENT
        teacher_id INTEGER REFERENCES teachers(id),
        student_id INTEGER REFERENCES students(id),
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        leave_type TEXT NOT NULL, -- CASUAL | MEDICAL | UNPAID | ACADEMIC
        is_paid INTEGER NOT NULL DEFAULT 1,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        days_count INTEGER NOT NULL DEFAULT 1,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
        reviewed_by_user_id INTEGER REFERENCES users(id),
        review_remarks TEXT NOT NULL DEFAULT '',
        reviewed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_leaves_branch_status ON leave_requests(branch_id, status);

      CREATE TABLE fee_structures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        course_id INTEGER REFERENCES courses(id),
        name TEXT NOT NULL,
        fee_category TEXT NOT NULL, -- ADMISSION | TUITION | INSTALMENT | EXAM | SUBJECT
        amount_paise INTEGER NOT NULL,
        late_fee_paise INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE fee_assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        batch_id INTEGER REFERENCES batches(id),
        fee_structure_id INTEGER REFERENCES fee_structures(id),
        title TEXT NOT NULL,
        gross_amount_paise INTEGER NOT NULL,
        discount_paise INTEGER NOT NULL DEFAULT 0,
        discount_reason TEXT NOT NULL DEFAULT '',
        adjustment_paise INTEGER NOT NULL DEFAULT 0,
        adjustment_reason TEXT NOT NULL DEFAULT '',
        due_date TEXT NOT NULL,
        created_by_user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_assessments_student ON fee_assessments(student_id);
      CREATE INDEX idx_assessments_branch ON fee_assessments(branch_id);

      CREATE TABLE payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_number TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        student_id INTEGER NOT NULL REFERENCES students(id),
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        amount_paise INTEGER NOT NULL,
        payment_method TEXT NOT NULL, -- CASH | UPI | BANK_TRANSFER | CHEQUE | ONLINE_VERIFIED
        reference_no TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'POSTED', -- POSTED | REVERSED | PENDING_VERIFICATION
        payment_date TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        received_by_user_id INTEGER NOT NULL REFERENCES users(id),
        reversed_at TEXT,
        reversal_reason TEXT NOT NULL DEFAULT '',
        reversed_by_user_id INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_payments_student ON payments(student_id);
      CREATE INDEX idx_payments_branch_date ON payments(branch_id, payment_date);

      CREATE TABLE payment_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
        assessment_id INTEGER NOT NULL REFERENCES fee_assessments(id) ON DELETE CASCADE,
        allocated_paise INTEGER NOT NULL,
        is_reversed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_allocations_assessment ON payment_allocations(assessment_id);

      CREATE TABLE fee_refunds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assessment_id INTEGER NOT NULL REFERENCES fee_assessments(id),
        student_id INTEGER NOT NULL REFERENCES students(id),
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        amount_paise INTEGER NOT NULL,
        reason TEXT NOT NULL,
        approved_by_user_id INTEGER NOT NULL REFERENCES users(id),
        refunded_at TEXT NOT NULL
      );

      CREATE TABLE payroll_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period_month TEXT NOT NULL, -- YYYY-MM
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        working_days INTEGER NOT NULL DEFAULT 26,
        status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | APPROVED | CLOSED
        calculated_by_user_id INTEGER NOT NULL REFERENCES users(id),
        approved_by_user_id INTEGER REFERENCES users(id),
        approved_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(period_month, branch_id)
      );

      CREATE TABLE payroll_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payroll_run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        teacher_id INTEGER NOT NULL REFERENCES teachers(id),
        salary_model TEXT NOT NULL,
        completed_lectures INTEGER NOT NULL DEFAULT 0,
        extra_lectures INTEGER NOT NULL DEFAULT 0,
        verified_hours REAL NOT NULL DEFAULT 0,
        present_days INTEGER NOT NULL DEFAULT 0,
        paid_leave_days INTEGER NOT NULL DEFAULT 0,
        unpaid_leave_days INTEGER NOT NULL DEFAULT 0,
        missing_checkin_days INTEGER NOT NULL DEFAULT 0,
        earned_base_paise INTEGER NOT NULL DEFAULT 0,
        lecture_earnings_paise INTEGER NOT NULL DEFAULT 0,
        allowances_paise INTEGER NOT NULL DEFAULT 0,
        incentives_paise INTEGER NOT NULL DEFAULT 0,
        reimbursements_paise INTEGER NOT NULL DEFAULT 0,
        leave_deduction_paise INTEGER NOT NULL DEFAULT 0,
        statutory_deduction_paise INTEGER NOT NULL DEFAULT 0,
        approved_deduction_paise INTEGER NOT NULL DEFAULT 0,
        gross_paise INTEGER NOT NULL DEFAULT 0,
        total_deductions_paise INTEGER NOT NULL DEFAULT 0,
        net_payable_paise INTEGER NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | DISBURSED
        disbursed_at TEXT,
        disbursement_ref TEXT NOT NULL DEFAULT '',
        UNIQUE(payroll_run_id, teacher_id)
      );

      CREATE TABLE examinations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exam_code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        batch_id INTEGER NOT NULL REFERENCES batches(id),
        subject_id INTEGER NOT NULL REFERENCES subjects(id),
        exam_date TEXT NOT NULL,
        max_marks REAL NOT NULL,
        passing_marks REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'PUBLISHED',
        created_by_user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
      );

      CREATE TABLE exam_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        examination_id INTEGER NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        marks_obtained REAL NOT NULL,
        percentage REAL NOT NULL,
        grade TEXT NOT NULL,
        passed INTEGER NOT NULL,
        remarks TEXT NOT NULL DEFAULT '',
        is_retake INTEGER NOT NULL DEFAULT 0,
        recorded_by_user_id INTEGER NOT NULL REFERENCES users(id),
        updated_at TEXT NOT NULL,
        UNIQUE(examination_id, student_id)
      );

      CREATE TABLE homework (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        batch_id INTEGER NOT NULL REFERENCES batches(id),
        subject_id INTEGER NOT NULL REFERENCES subjects(id),
        assigned_by_teacher_id INTEGER NOT NULL REFERENCES teachers(id),
        chapter_name TEXT NOT NULL,
        title TEXT NOT NULL,
        instructions TEXT NOT NULL,
        due_date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE homework_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        homework_id INTEGER NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | SUBMITTED | REVIEWED | OVERDUE
        submission_notes TEXT NOT NULL DEFAULT '',
        teacher_feedback TEXT NOT NULL DEFAULT '',
        submitted_at TEXT,
        reviewed_at TEXT,
        UNIQUE(homework_id, student_id)
      );

      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        branch_id INTEGER REFERENCES branches(id),
        target_role TEXT, -- NULL = all roles in branch, or specific role code
        target_user_id INTEGER REFERENCES users(id),
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'IN_APP', -- IN_APP | EMAIL | SMS | WHATSAPP
        delivery_mode TEXT NOT NULL DEFAULT 'LIVE', -- LIVE | DEV_SANDBOX
        delivery_status TEXT NOT NULL DEFAULT 'DELIVERED',
        dedupe_key TEXT UNIQUE,
        is_read INTEGER NOT NULL DEFAULT 0,
        created_by_user_id INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_notifications_branch ON notifications(branch_id);

      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id INTEGER REFERENCES users(id),
        actor_name TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        branch_id INTEGER REFERENCES branches(id),
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        outcome TEXT NOT NULL DEFAULT 'SUCCESS',
        correlation_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
      CREATE INDEX idx_audit_branch ON audit_logs(branch_id);
    `);

    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      '001_initial_ims_schema',
      new Date().toISOString()
    );
  });

  migrate();
}
