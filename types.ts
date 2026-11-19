export enum RoleCode {
  SUPER_ADMIN = 'SUPER_ADMIN',
  BRANCH_ADMIN = 'BRANCH_ADMIN',
  TEACHER = 'TEACHER',
  ACCOUNTANT = 'ACCOUNTANT',
  RECEPTIONIST = 'RECEPTIONIST',
  STUDENT = 'STUDENT',
  PARENT = 'PARENT',
}

export enum Permission {
  DASHBOARD_VIEW = 'dashboard:view',
  BRANCH_MANAGE = 'branch:manage',
  BRANCH_SWITCH = 'branch:switch',
  USER_MANAGE = 'user:manage',
  ROLE_MANAGE = 'role:manage',
  STUDENT_VIEW = 'student:view',
  STUDENT_MANAGE = 'student:manage',
  TEACHER_VIEW = 'teacher:view',
  TEACHER_MANAGE = 'teacher:manage',
  ACADEMIC_VIEW = 'academic:view',
  ACADEMIC_MANAGE = 'academic:manage',
  TEACHING_RECORD_SUBMIT = 'teaching_record:submit',
  TEACHING_RECORD_REVIEW = 'teaching_record:review',
  ATTENDANCE_STUDENT_MARK = 'attendance:student_mark',
  ATTENDANCE_STUDENT_OVERRIDE = 'attendance:student_override',
  MOVEMENT_RECORD = 'movement:record',
  TEACHER_VERIFICATION_HOST = 'teacher_verification:host',
  TEACHER_VERIFICATION_CHECKIN = 'teacher_verification:checkin',
  LEAVE_REQUEST = 'leave:request',
  LEAVE_APPROVE = 'leave:approve',
  FEE_VIEW = 'fee:view',
  FEE_COLLECT = 'fee:collect',
  FEE_ADJUST = 'fee:adjust',
  PAYROLL_VIEW_OWN = 'payroll:view_own',
  PAYROLL_CALCULATE = 'payroll:calculate',
  PAYROLL_APPROVE = 'payroll:approve',
  EXAM_VIEW = 'exam:view',
  EXAM_MANAGE = 'exam:manage',
  HOMEWORK_VIEW = 'homework:view',
  HOMEWORK_MANAGE = 'homework:manage',
  PORTAL_STUDENT = 'portal:student',
  PORTAL_PARENT = 'portal:parent',
  NOTIFICATION_MANAGE = 'notification:manage',
  REPORT_VIEW = 'report:view',
  REPORT_EXPORT = 'report:export',
  AUDIT_VIEW = 'audit:view',
  BACKUP_MANAGE = 'backup:manage',
}

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  [RoleCode.SUPER_ADMIN]: Object.values(Permission),
  [RoleCode.BRANCH_ADMIN]: [
    Permission.DASHBOARD_VIEW,
    Permission.STUDENT_VIEW,
    Permission.STUDENT_MANAGE,
    Permission.TEACHER_VIEW,
    Permission.TEACHER_MANAGE,
    Permission.ACADEMIC_VIEW,
    Permission.ACADEMIC_MANAGE,
    Permission.TEACHING_RECORD_SUBMIT,
    Permission.TEACHING_RECORD_REVIEW,
    Permission.ATTENDANCE_STUDENT_MARK,
    Permission.ATTENDANCE_STUDENT_OVERRIDE,
    Permission.MOVEMENT_RECORD,
    Permission.TEACHER_VERIFICATION_HOST,
    Permission.LEAVE_REQUEST,
    Permission.LEAVE_APPROVE,
    Permission.FEE_VIEW,
    Permission.FEE_COLLECT,
    Permission.FEE_ADJUST,
    Permission.PAYROLL_CALCULATE,
    Permission.EXAM_VIEW,
    Permission.EXAM_MANAGE,
    Permission.HOMEWORK_VIEW,
    Permission.HOMEWORK_MANAGE,
    Permission.NOTIFICATION_MANAGE,
    Permission.REPORT_VIEW,
    Permission.REPORT_EXPORT,
    Permission.AUDIT_VIEW,
  ],
  [RoleCode.TEACHER]: [
    Permission.DASHBOARD_VIEW,
    Permission.STUDENT_VIEW,
    Permission.ACADEMIC_VIEW,
    Permission.TEACHING_RECORD_SUBMIT,
    Permission.ATTENDANCE_STUDENT_MARK,
    Permission.TEACHER_VERIFICATION_CHECKIN,
    Permission.LEAVE_REQUEST,
    Permission.PAYROLL_VIEW_OWN,
    Permission.EXAM_VIEW,
    Permission.EXAM_MANAGE,
    Permission.HOMEWORK_VIEW,
    Permission.HOMEWORK_MANAGE,
  ],
  [RoleCode.ACCOUNTANT]: [
    Permission.DASHBOARD_VIEW,
    Permission.STUDENT_VIEW,
    Permission.FEE_VIEW,
    Permission.FEE_COLLECT,
    Permission.FEE_ADJUST,
    Permission.PAYROLL_CALCULATE,
    Permission.REPORT_VIEW,
    Permission.REPORT_EXPORT,
  ],
  [RoleCode.RECEPTIONIST]: [
    Permission.DASHBOARD_VIEW,
    Permission.STUDENT_VIEW,
    Permission.STUDENT_MANAGE,
    Permission.TEACHER_VIEW,
    Permission.ACADEMIC_VIEW,
    Permission.MOVEMENT_RECORD,
    Permission.TEACHER_VERIFICATION_HOST,
    Permission.FEE_VIEW,
    Permission.FEE_COLLECT,
    Permission.NOTIFICATION_MANAGE,
  ],
  [RoleCode.STUDENT]: [
    Permission.PORTAL_STUDENT,
    Permission.LEAVE_REQUEST,
    Permission.HOMEWORK_VIEW,
    Permission.EXAM_VIEW,
  ],
  [RoleCode.PARENT]: [
    Permission.PORTAL_PARENT,
    Permission.HOMEWORK_VIEW,
    Permission.EXAM_VIEW,
  ],
};

export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  roleCode: RoleCode;
  roleName: string;
  branchId: number | null;
  branchName: string | null;
  permissions: Permission[];
  mfaEnabled: boolean;
  teacherId?: number | null;
  studentId?: number | null;
  guardianId?: number | null;
}

export interface Branch {
  id: number;
  code: string;
  name: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  isActive: number;
  createdAt: string;
}

export type SessionStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'CANCELLED'
  | 'RESCHEDULED'
  | 'NOT_CONDUCTED';

export type StudentAttendanceStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'LATE'
  | 'APPROVED_LEAVE'
  | 'NOT_RECORDED';

export type SalaryModel =
  | 'FIXED_MONTHLY'
  | 'PER_LECTURE'
  | 'HOURLY'
  | 'CONTRACT'
  | 'BASE_PLUS_INCENTIVE';
