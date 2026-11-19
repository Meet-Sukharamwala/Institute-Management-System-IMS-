-- Institute Management System (IMS) — Canonical MySQL 8.0+ Relational Schema
-- Monetary columns store exact integer paise (BIGINT) or DECIMAL(12,2) without IEEE-754 floating-point drift.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE IF NOT EXISTS branches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  city VARCHAR(80) NOT NULL,
  state VARCHAR(80) NOT NULL,
  address TEXT NOT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(160) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(96) NOT NULL,
  description VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT NOT NULL,
  permission VARCHAR(64) NOT NULL,
  PRIMARY KEY (role_id, permission),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(191) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(32) NOT NULL DEFAULT '',
  role_id INT NOT NULL,
  primary_branch_id INT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  mfa_enabled TINYINT(1) NOT NULL DEFAULT 0,
  mfa_pin_hash VARCHAR(255) NULL,
  failed_login_count INT NOT NULL DEFAULT 0,
  locked_until_ms BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_users_branch (primary_branch_id),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id),
  CONSTRAINT fk_users_branch FOREIGN KEY (primary_branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id VARCHAR(96) PRIMARY KEY,
  user_id INT NOT NULL,
  csrf_token VARCHAR(96) NOT NULL,
  ip_address VARCHAR(64) NOT NULL DEFAULT '',
  user_agent VARCHAR(255) NOT NULL DEFAULT '',
  expires_at_ms BIGINT NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salary_structures (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL UNIQUE,
  model ENUM('FIXED_MONTHLY','PER_LECTURE','HOURLY','CONTRACT','BASE_PLUS_INCENTIVE') NOT NULL,
  base_salary_paise BIGINT NOT NULL DEFAULT 0,
  per_lecture_rate_paise BIGINT NOT NULL DEFAULT 0,
  hourly_rate_paise BIGINT NOT NULL DEFAULT 0,
  allowances_paise BIGINT NOT NULL DEFAULT 0,
  statutory_deduction_paise BIGINT NOT NULL DEFAULT 0,
  deduct_unpaid_leave TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teachers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_code VARCHAR(32) NOT NULL UNIQUE,
  user_id INT NOT NULL UNIQUE,
  full_name VARCHAR(160) NOT NULL,
  designation VARCHAR(120) NOT NULL,
  employment_type ENUM('FULL_TIME','VISITING','CONTRACT') NOT NULL,
  joining_date DATE NOT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(191) NOT NULL,
  primary_branch_id INT NOT NULL,
  subjects_csv VARCHAR(255) NOT NULL DEFAULT '',
  salary_structure_id INT NOT NULL,
  status ENUM('ACTIVE','ON_LEAVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_teachers_branch (primary_branch_id),
  CONSTRAINT fk_teachers_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_teachers_branch FOREIGN KEY (primary_branch_id) REFERENCES branches(id),
  CONSTRAINT fk_teachers_salary FOREIGN KEY (salary_structure_id) REFERENCES salary_structures(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_code VARCHAR(32) NOT NULL UNIQUE,
  user_id INT NULL UNIQUE,
  full_name VARCHAR(160) NOT NULL,
  dob DATE NULL,
  gender VARCHAR(24) NOT NULL DEFAULT '',
  phone VARCHAR(32) NOT NULL DEFAULT '',
  email VARCHAR(191) NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  academic_level VARCHAR(80) NOT NULL,
  previous_school VARCHAR(160) NOT NULL DEFAULT '',
  admission_date DATE NOT NULL,
  branch_id INT NOT NULL,
  status ENUM('ACTIVE','ON_LEAVE','COMPLETED','DROPPED','TRANSFERRED','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  emergency_contact VARCHAR(160) NOT NULL DEFAULT '',
  notes TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_students_branch_status (branch_id, status),
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_students_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guardians (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL UNIQUE,
  full_name VARCHAR(160) NOT NULL,
  relationship VARCHAR(64) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(191) NOT NULL DEFAULT '',
  occupation VARCHAR(120) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_guardians_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_guardians (
  student_id INT NOT NULL,
  guardian_id INT NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (student_id, guardian_id),
  CONSTRAINT fk_sg_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_sg_guardian FOREIGN KEY (guardian_id) REFERENCES guardians(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  academic_level VARCHAR(80) NOT NULL,
  duration_months INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  default_fee_paise BIGINT NOT NULL,
  branch_id INT NOT NULL,
  status ENUM('ACTIVE','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_courses_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_course_sub (course_id, code),
  CONSTRAINT fk_subjects_course FOREIGN KEY (course_id) REFERENCES courses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS syllabus_topics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subject_id INT NOT NULL,
  chapter_name VARCHAR(160) NOT NULL,
  topic_title VARCHAR(200) NOT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  planned_date DATE NULL,
  CONSTRAINT fk_topics_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  course_id INT NOT NULL,
  branch_id INT NOT NULL,
  classroom VARCHAR(80) NOT NULL DEFAULT '',
  max_capacity INT NOT NULL DEFAULT 40,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('ACTIVE','COMPLETED','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_batches_course FOREIGN KEY (course_id) REFERENCES courses(id),
  CONSTRAINT fk_batches_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enrolments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  batch_id INT NOT NULL,
  enrolled_on DATE NOT NULL,
  status ENUM('ACTIVE','TRANSFERRED','COMPLETED','DROPPED') NOT NULL DEFAULT 'ACTIVE',
  UNIQUE KEY uq_student_batch (student_id, batch_id),
  CONSTRAINT fk_enrolments_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_enrolments_batch FOREIGN KEY (batch_id) REFERENCES batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS class_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_code VARCHAR(40) NOT NULL UNIQUE,
  branch_id INT NOT NULL,
  course_id INT NOT NULL,
  batch_id INT NOT NULL,
  subject_id INT NOT NULL,
  assigned_teacher_id INT NOT NULL,
  substitute_teacher_id INT NULL,
  conducted_by_teacher_id INT NULL,
  session_date DATE NOT NULL,
  scheduled_start CHAR(5) NOT NULL,
  scheduled_end CHAR(5) NOT NULL,
  classroom VARCHAR(80) NOT NULL DEFAULT '',
  status ENUM('SCHEDULED','IN_PROGRESS','COMPLETED','PARTIALLY_COMPLETED','CANCELLED','RESCHEDULED','NOT_CONDUCTED') NOT NULL DEFAULT 'SCHEDULED',
  cancellation_reason VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_sessions_branch_date (branch_id, session_date),
  CONSTRAINT fk_cs_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_cs_batch FOREIGN KEY (batch_id) REFERENCES batches(id),
  CONSTRAINT fk_cs_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_cs_teacher FOREIGN KEY (assigned_teacher_id) REFERENCES teachers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teaching_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  class_session_id INT NOT NULL UNIQUE,
  submitted_by_teacher_id INT NOT NULL,
  actual_start CHAR(5) NOT NULL,
  actual_end CHAR(5) NOT NULL,
  chapter_covered VARCHAR(160) NOT NULL,
  topics_summary TEXT NOT NULL,
  coverage_status ENUM('COMPLETED','PARTIALLY_COMPLETED') NOT NULL,
  homework_assigned TEXT NOT NULL,
  next_lesson_plan TEXT NOT NULL,
  student_observations TEXT NOT NULL,
  remarks TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_tr_session FOREIGN KEY (class_session_id) REFERENCES class_sessions(id),
  CONSTRAINT fk_tr_teacher FOREIGN KEY (submitted_by_teacher_id) REFERENCES teachers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  class_session_id INT NOT NULL,
  student_id INT NOT NULL,
  status ENUM('PRESENT','ABSENT','LATE','APPROVED_LEAVE') NOT NULL,
  previous_status VARCHAR(32) NULL,
  recorded_by_user_id INT NOT NULL,
  correction_reason VARCHAR(255) NOT NULL DEFAULT '',
  recorded_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_session_student (class_session_id, student_id),
  CONSTRAINT fk_sa_session FOREIGN KEY (class_session_id) REFERENCES class_sessions(id),
  CONSTRAINT fk_sa_student FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  branch_id INT NOT NULL,
  movement_date DATE NOT NULL,
  entry_time CHAR(5) NOT NULL,
  exit_time CHAR(5) NULL,
  recording_method ENUM('STAFF_DESK','QR_BADGE','RFID_GATE') NOT NULL,
  recorded_by_user_id INT NOT NULL,
  exception_flag TINYINT(1) NOT NULL DEFAULT 0,
  exception_reason VARCHAR(255) NOT NULL DEFAULT '',
  resolved_by_user_id INT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_movements_branch_date (branch_id, movement_date),
  CONSTRAINT fk_sm_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_sm_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_verification_challenges (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NOT NULL,
  issued_by_user_id INT NOT NULL,
  applicable_teacher_id INT NULL,
  code_hint VARCHAR(8) NOT NULL,
  secret_hash CHAR(64) NOT NULL,
  salt VARCHAR(32) NOT NULL,
  usage_policy ENUM('SINGLE_USE_GLOBAL','PER_TEACHER_DAILY') NOT NULL,
  issued_at_ms BIGINT NOT NULL,
  expires_at_ms BIGINT NOT NULL,
  revoked_at_ms BIGINT NULL,
  consumed_count INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_tvc_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  branch_id INT NOT NULL,
  attendance_date DATE NOT NULL,
  status ENUM('CHECKED_IN','CHECKED_OUT','MANUAL_OVERRIDE','APPROVED_LEAVE') NOT NULL,
  check_in_at DATETIME(3) NULL,
  check_out_at DATETIME(3) NULL,
  duration_minutes INT NOT NULL DEFAULT 0,
  challenge_id INT NULL,
  verified_by_user_id INT NULL,
  override_reason VARCHAR(255) NOT NULL DEFAULT '',
  UNIQUE KEY uq_teacher_date (teacher_id, attendance_date),
  CONSTRAINT fk_ta_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id),
  CONSTRAINT fk_ta_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fee_assessments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  branch_id INT NOT NULL,
  batch_id INT NULL,
  title VARCHAR(160) NOT NULL,
  gross_amount_paise BIGINT NOT NULL,
  discount_paise BIGINT NOT NULL DEFAULT 0,
  discount_reason VARCHAR(255) NOT NULL DEFAULT '',
  adjustment_paise BIGINT NOT NULL DEFAULT 0,
  adjustment_reason VARCHAR(255) NOT NULL DEFAULT '',
  due_date DATE NOT NULL,
  created_by_user_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_fees_student (student_id),
  CONSTRAINT fk_fa_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_fa_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  receipt_number VARCHAR(40) NOT NULL UNIQUE,
  idempotency_key VARCHAR(96) NOT NULL UNIQUE,
  student_id INT NOT NULL,
  branch_id INT NOT NULL,
  amount_paise BIGINT NOT NULL,
  payment_method ENUM('CASH','UPI','BANK_TRANSFER','CHEQUE','ONLINE_VERIFIED') NOT NULL,
  reference_no VARCHAR(96) NOT NULL DEFAULT '',
  payment_date DATE NOT NULL,
  status ENUM('POSTED','REVERSED') NOT NULL DEFAULT 'POSTED',
  reversed_at DATETIME(3) NULL,
  reversed_by_user_id INT NULL,
  reversal_reason VARCHAR(255) NOT NULL DEFAULT '',
  collected_by_user_id INT NOT NULL,
  notes VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pay_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_pay_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payroll_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  period_month CHAR(7) NOT NULL,
  branch_id INT NOT NULL,
  working_days INT NOT NULL DEFAULT 26,
  status ENUM('DRAFT','APPROVED','CLOSED') NOT NULL DEFAULT 'DRAFT',
  calculated_by_user_id INT NOT NULL,
  approved_by_user_id INT NULL,
  approved_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_payroll_period_branch (period_month, branch_id),
  CONSTRAINT fk_pr_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_user_id INT NULL,
  actor_name VARCHAR(160) NOT NULL,
  actor_role VARCHAR(32) NOT NULL,
  branch_id INT NULL,
  action VARCHAR(96) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  outcome VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
  correlation_id VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_audit_branch_created (branch_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
