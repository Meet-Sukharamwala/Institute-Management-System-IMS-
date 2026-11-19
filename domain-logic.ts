import { Permission, RoleCode } from './types';

/**
 * Pure financial arithmetic using integer paise (1 INR = 100 paise)
 * to eliminate IEEE-754 floating-point drift across fee assessments,
 * allocations, discounts, refunds, and payroll calculations.
 */
export function inrToPaise(inr: number | string): number {
  const numeric = typeof inr === 'string' ? Number(inr.trim()) : inr;
  if (!Number.isFinite(numeric)) {
    throw new Error('Invalid monetary amount');
  }
  return Math.round(numeric * 100);
}

export function paiseToInrString(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  return `${sign}${rupees}.${rem}`;
}

export function formatInrDisplay(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export interface FeeAssessmentCalcInput {
  grossAmountPaise: number;
  discountPaise: number;
  adjustmentPaise: number; // positive adds charge (e.g. late fee), negative waives
  allocatedPaidPaise: number;
  refundedPaise: number;
}

export interface FeeAssessmentCalcResult {
  netPayablePaise: number;
  effectivePaidPaise: number;
  outstandingPaise: number;
  status: 'PAID' | 'PARTIAL' | 'OVERDUE' | 'PENDING' | 'WAIVED';
}

export function calculateFeeBalance(
  input: FeeAssessmentCalcInput,
  dueDateIso: string,
  referenceDateIso: string
): FeeAssessmentCalcResult {
  const netPayablePaise = Math.max(
    0,
    input.grossAmountPaise - input.discountPaise + input.adjustmentPaise
  );
  const effectivePaidPaise = Math.max(0, input.allocatedPaidPaise - input.refundedPaise);
  const outstandingPaise = Math.max(0, netPayablePaise - effectivePaidPaise);

  let status: FeeAssessmentCalcResult['status'] = 'PENDING';
  if (netPayablePaise === 0) {
    status = 'WAIVED';
  } else if (outstandingPaise === 0) {
    status = 'PAID';
  } else if (effectivePaidPaise > 0) {
    status = dueDateIso < referenceDateIso ? 'OVERDUE' : 'PARTIAL';
  } else if (dueDateIso < referenceDateIso) {
    status = 'OVERDUE';
  }

  return {
    netPayablePaise,
    effectivePaidPaise,
    outstandingPaise,
    status,
  };
}

export interface ObligationItem {
  assessmentId: number;
  dueDateIso: string;
  outstandingPaise: number;
}

export interface AllocationEntry {
  assessmentId: number;
  allocatedPaise: number;
}

/**
 * Allocates an incoming payment deterministically (oldest due date first,
 * then lowest assessment ID) without exceeding any assessment's outstanding balance.
 */
export function allocatePaymentFIFO(
  paymentAmountPaise: number,
  obligations: ObligationItem[]
): { allocations: AllocationEntry[]; unallocatedPaise: number } {
  if (paymentAmountPaise <= 0) {
    throw new Error('Payment amount must be strictly positive');
  }
  const sorted = [...obligations]
    .filter((o) => o.outstandingPaise > 0)
    .sort((a, b) => {
      if (a.dueDateIso !== b.dueDateIso) return a.dueDateIso.localeCompare(b.dueDateIso);
      return a.assessmentId - b.assessmentId;
    });

  let remaining = paymentAmountPaise;
  const allocations: AllocationEntry[] = [];

  for (const item of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, item.outstandingPaise);
    if (take > 0) {
      allocations.push({ assessmentId: item.assessmentId, allocatedPaise: take });
      remaining -= take;
    }
  }

  return { allocations, unallocatedPaise: remaining };
}

export interface SalaryCalculationInput {
  model: 'FIXED_MONTHLY' | 'PER_LECTURE' | 'HOURLY' | 'CONTRACT' | 'BASE_PLUS_INCENTIVE';
  baseSalaryPaise: number;
  perLectureRatePaise: number;
  hourlyRatePaise: number;
  allowancesPaise: number;
  incentivesPaise: number;
  statutoryDeductionPaise: number;
  approvedDeductionPaise: number;
  reimbursementsPaise: number;
  completedLecturesCount: number;
  extraLecturesCount: number;
  verifiedHoursWorked: number;
  workingDaysInPeriod: number;
  unpaidLeaveDays: number;
  deductUnpaidLeave: boolean;
}

export interface SalaryCalculationResult {
  earnedBasePaise: number;
  lectureEarningsPaise: number;
  leaveDeductionPaise: number;
  grossEarningsPaise: number;
  totalDeductionsPaise: number;
  netPayablePaise: number;
}

export function calculateTeacherPayroll(input: SalaryCalculationInput): SalaryCalculationResult {
  let earnedBasePaise = 0;
  let lectureEarningsPaise = 0;

  switch (input.model) {
    case 'FIXED_MONTHLY':
    case 'CONTRACT':
      earnedBasePaise = input.baseSalaryPaise;
      lectureEarningsPaise = input.extraLecturesCount * input.perLectureRatePaise;
      break;
    case 'PER_LECTURE':
      earnedBasePaise = 0;
      lectureEarningsPaise =
        (input.completedLecturesCount + input.extraLecturesCount) * input.perLectureRatePaise;
      break;
    case 'HOURLY':
      earnedBasePaise = Math.round(input.verifiedHoursWorked * input.hourlyRatePaise);
      break;
    case 'BASE_PLUS_INCENTIVE':
      earnedBasePaise = input.baseSalaryPaise;
      lectureEarningsPaise = input.extraLecturesCount * input.perLectureRatePaise;
      break;
  }

  let leaveDeductionPaise = 0;
  if (
    input.deductUnpaidLeave &&
    input.unpaidLeaveDays > 0 &&
    input.workingDaysInPeriod > 0 &&
    earnedBasePaise > 0
  ) {
    leaveDeductionPaise = Math.round(
      (earnedBasePaise * input.unpaidLeaveDays) / input.workingDaysInPeriod
    );
  }

  const grossEarningsPaise =
    earnedBasePaise +
    lectureEarningsPaise +
    input.allowancesPaise +
    input.incentivesPaise +
    input.reimbursementsPaise;

  const totalDeductionsPaise =
    leaveDeductionPaise + input.statutoryDeductionPaise + input.approvedDeductionPaise;

  const netPayablePaise = Math.max(0, grossEarningsPaise - totalDeductionsPaise);

  return {
    earnedBasePaise,
    lectureEarningsPaise,
    leaveDeductionPaise,
    grossEarningsPaise,
    totalDeductionsPaise,
    netPayablePaise,
  };
}

export interface VerificationChallengeRuleInput {
  isActive: boolean;
  isRevoked: boolean;
  expiresAtMs: number;
  nowMs: number;
  challengeBranchId: number;
  teacherBranchIds: number[];
  applicableTeacherId: number | null;
  requestingTeacherId: number;
  usagePolicy: 'ONE_TIME_PER_TEACHER' | 'SINGLE_USE_GLOBAL';
  alreadyConsumedByTeacher: boolean;
  totalConsumptionCount: number;
  codeHashMatches: boolean;
}

export function validateVerificationChallenge(
  input: VerificationChallengeRuleInput
): { valid: boolean; reason?: string } {
  if (!input.isActive || input.isRevoked) {
    return { valid: false, reason: 'Verification challenge has been revoked or deactivated.' };
  }
  if (input.nowMs > input.expiresAtMs) {
    return { valid: false, reason: 'Verification challenge has expired.' };
  }
  if (!input.teacherBranchIds.includes(input.challengeBranchId)) {
    return { valid: false, reason: 'Teacher is not assigned to the challenge branch.' };
  }
  if (
    input.applicableTeacherId !== null &&
    input.applicableTeacherId !== input.requestingTeacherId
  ) {
    return { valid: false, reason: 'Challenge is restricted to a different faculty member.' };
  }
  if (input.usagePolicy === 'SINGLE_USE_GLOBAL' && input.totalConsumptionCount > 0) {
    return { valid: false, reason: 'One-time challenge code has already been consumed.' };
  }
  if (input.alreadyConsumedByTeacher) {
    return { valid: false, reason: 'You have already consumed this verification challenge.' };
  }
  if (!input.codeHashMatches) {
    return { valid: false, reason: 'Invalid verification code.' };
  }
  return { valid: true };
}

export interface TopicCoverageItem {
  topicId: number;
  status: 'PENDING' | 'PARTIAL' | 'COMPLETED';
}

/**
 * Calculates syllabus completion deduplicating topics so teaching the same
 * topic across multiple revision sessions never inflates completion > 100%.
 */
export function calculateSyllabusProgress(topics: TopicCoverageItem[]): {
  totalTopics: number;
  completedTopics: number;
  partialTopics: number;
  pendingTopics: number;
  coveragePercentage: number;
} {
  const map = new Map<number, 'PENDING' | 'PARTIAL' | 'COMPLETED'>();
  const rank = { PENDING: 0, PARTIAL: 1, COMPLETED: 2 };

  for (const item of topics) {
    const existing = map.get(item.topicId);
    if (!existing || rank[item.status] > rank[existing]) {
      map.set(item.topicId, item.status);
    }
  }

  let completedTopics = 0;
  let partialTopics = 0;
  let pendingTopics = 0;

  for (const status of map.values()) {
    if (status === 'COMPLETED') completedTopics++;
    else if (status === 'PARTIAL') partialTopics++;
    else pendingTopics++;
  }

  const totalTopics = map.size;
  const weighted = completedTopics + partialTopics * 0.5;
  const coveragePercentage =
    totalTopics === 0 ? 0 : Math.round((weighted / totalTopics) * 1000) / 10;

  return {
    totalTopics,
    completedTopics,
    partialTopics,
    pendingTopics,
    coveragePercentage,
  };
}

export interface GradeRule {
  minPercentage: number;
  grade: string;
  remark: string;
}

export const DEFAULT_INDIAN_GRADING_RULES: GradeRule[] = [
  { minPercentage: 90, grade: 'A1', remark: 'Outstanding' },
  { minPercentage: 80, grade: 'A2', remark: 'Excellent' },
  { minPercentage: 70, grade: 'B1', remark: 'Very Good' },
  { minPercentage: 60, grade: 'B2', remark: 'Good' },
  { minPercentage: 50, grade: 'C1', remark: 'Satisfactory' },
  { minPercentage: 35, grade: 'D', remark: 'Pass' },
  { minPercentage: 0, grade: 'E', remark: 'Needs Improvement' },
];

export function evaluateExamResult(
  marksObtained: number,
  maxMarks: number,
  passingMarks: number,
  rules: GradeRule[] = DEFAULT_INDIAN_GRADING_RULES
): { percentage: number; grade: string; remark: string; passed: boolean } {
  if (maxMarks <= 0) throw new Error('Maximum marks must be greater than zero');
  if (marksObtained < 0 || marksObtained > maxMarks) {
    throw new Error('Marks obtained must be between 0 and maximum marks');
  }
  const percentage = Math.round((marksObtained / maxMarks) * 10000) / 100;
  const sorted = [...rules].sort((a, b) => b.minPercentage - a.minPercentage);
  const matched = sorted.find((r) => percentage >= r.minPercentage) ?? {
    grade: 'E',
    remark: 'Needs Improvement',
  };
  return {
    percentage,
    grade: matched.grade,
    remark: matched.remark,
    passed: marksObtained >= passingMarks,
  };
}

export function calculateAttendanceSummary(
  statuses: Array<'PRESENT' | 'ABSENT' | 'LATE' | 'APPROVED_LEAVE' | 'NOT_RECORDED'>
): {
  conductedCount: number;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  approvedLeaveCount: number;
  attendancePercentage: number;
} {
  let presentCount = 0;
  let lateCount = 0;
  let absentCount = 0;
  let approvedLeaveCount = 0;

  for (const s of statuses) {
    if (s === 'PRESENT') presentCount++;
    else if (s === 'LATE') lateCount++;
    else if (s === 'ABSENT') absentCount++;
    else if (s === 'APPROVED_LEAVE') approvedLeaveCount++;
  }

  const conductedCount = presentCount + lateCount + absentCount + approvedLeaveCount;
  const attendedCount = presentCount + lateCount;
  const attendancePercentage =
    conductedCount === 0 ? 0 : Math.round((attendedCount / conductedCount) * 1000) / 10;

  return {
    conductedCount,
    presentCount,
    lateCount,
    absentCount,
    approvedLeaveCount,
    attendancePercentage,
  };
}

export function canAccessBranchResource(
  userRole: RoleCode,
  userPermissions: Permission[],
  userBranchId: number | null,
  targetBranchId: number,
  requiredPermission: Permission
): boolean {
  if (!userPermissions.includes(requiredPermission)) {
    return false;
  }
  if (userRole === RoleCode.SUPER_ADMIN || userPermissions.includes(Permission.BRANCH_SWITCH)) {
    return true;
  }
  return userBranchId !== null && userBranchId === targetBranchId;
}

export function hasScheduleConflict(
  existingSlots: Array<{ startTime: string; endTime: string; teacherId: number; classroom: string | null }>,
  candidate: { startTime: string; endTime: string; teacherId: number; classroom: string | null }
): { conflict: boolean; reason?: string } {
  if (candidate.startTime >= candidate.endTime) {
    return { conflict: true, reason: 'Start time must precede end time.' };
  }
  for (const slot of existingSlots) {
    const overlaps = candidate.startTime < slot.endTime && candidate.endTime > slot.startTime;
    if (!overlaps) continue;
    if (slot.teacherId === candidate.teacherId) {
      return {
        conflict: true,
        reason: `Teacher already has an overlapping session (${slot.startTime}–${slot.endTime}).`,
      };
    }
    if (
      candidate.classroom &&
      slot.classroom &&
      candidate.classroom.trim().toLowerCase() === slot.classroom.trim().toLowerCase()
    ) {
      return {
        conflict: true,
        reason: `Classroom "${candidate.classroom}" is already booked (${slot.startTime}–${slot.endTime}).`,
      };
    }
  }
  return { conflict: false };
}
