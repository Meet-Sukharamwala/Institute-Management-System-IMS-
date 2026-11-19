import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inrToPaise,
  paiseToInrString,
  calculateFeeBalance,
  allocatePaymentFIFO,
  calculateTeacherPayroll,
  validateVerificationChallenge,
  calculateSyllabusProgress,
  evaluateExamResult,
  calculateAttendanceSummary,
  canAccessBranchResource,
  hasScheduleConflict,
} from './domain-logic';
import { Permission, RoleCode } from './types';

test('monetary paise conversions avoid floating-point drift', () => {
  assert.equal(inrToPaise('14999.90'), 1499990);
  assert.equal(inrToPaise(0.1 + 0.2), 30);
  assert.equal(paiseToInrString(1499990), '14999.90');
  assert.equal(paiseToInrString(505), '5.05');
});

test('fee balance calculation handles discounts, late adjustments, refunds, and overdue status', () => {
  const res = calculateFeeBalance(
    {
      grossAmountPaise: 2500000, // ₹25,000
      discountPaise: 250000,     // ₹2,500 scholarship
      adjustmentPaise: 50000,    // ₹500 late fee
      allocatedPaidPaise: 1500000, // ₹15,000 paid
      refundedPaise: 200000,     // ₹2,000 refunded
    },
    '2026-10-01',
    '2026-10-29'
  );
  // Net payable: 25000 - 2500 + 500 = 23000 (2300000 paise)
  // Effective paid: 15000 - 2000 = 13000 (1300000 paise)
  // Outstanding: 10000 (1000000 paise), overdue since 2026-10-01 < 2026-10-29
  assert.equal(res.netPayablePaise, 2300000);
  assert.equal(res.effectivePaidPaise, 1300000);
  assert.equal(res.outstandingPaise, 1000000);
  assert.equal(res.status, 'OVERDUE');
});

test('FIFO payment allocation settles oldest obligations first without over-allocating', () => {
  const result = allocatePaymentFIFO(1800000, [
    { assessmentId: 12, dueDateIso: '2026-11-10', outstandingPaise: 1200000 },
    { assessmentId: 8, dueDateIso: '2026-09-10', outstandingPaise: 1000000 },
    { assessmentId: 9, dueDateIso: '2026-10-10', outstandingPaise: 1000000 },
  ]);
  assert.deepEqual(result.allocations, [
    { assessmentId: 8, allocatedPaise: 1000000 },
    { assessmentId: 9, allocatedPaise: 800000 },
  ]);
  assert.equal(result.unallocatedPaise, 0);
});

test('teacher payroll calculation respects configured leave deduction policy and lecture models', () => {
  // Policy 1: Approved/unpaid leave deduction disabled -> no automatic deduction
  const withoutDeduction = calculateTeacherPayroll({
    model: 'FIXED_MONTHLY',
    baseSalaryPaise: 6000000, // ₹60,000
    perLectureRatePaise: 120000, // ₹1,200 extra lecture
    hourlyRatePaise: 0,
    allowancesPaise: 500000,
    incentivesPaise: 0,
    statutoryDeductionPaise: 180000, // PF/PT ₹1,800
    approvedDeductionPaise: 0,
    reimbursementsPaise: 100000,
    completedLecturesCount: 22,
    extraLecturesCount: 3, // ₹3,600
    verifiedHoursWorked: 88,
    workingDaysInPeriod: 26,
    unpaidLeaveDays: 2,
    deductUnpaidLeave: false,
  });
  assert.equal(withoutDeduction.leaveDeductionPaise, 0);
  assert.equal(withoutDeduction.grossEarningsPaise, 6960000);
  assert.equal(withoutDeduction.netPayablePaise, 6780000);

  // Policy 2: Unpaid leave deduction enabled -> pro-rata deduction applied
  const withDeduction = calculateTeacherPayroll({
    model: 'FIXED_MONTHLY',
    baseSalaryPaise: 5200000, // ₹52,000 across 26 days = ₹2,000/day
    perLectureRatePaise: 0,
    hourlyRatePaise: 0,
    allowancesPaise: 0,
    incentivesPaise: 0,
    statutoryDeductionPaise: 20000,
    approvedDeductionPaise: 0,
    reimbursementsPaise: 0,
    completedLecturesCount: 20,
    extraLecturesCount: 0,
    verifiedHoursWorked: 80,
    workingDaysInPeriod: 26,
    unpaidLeaveDays: 2,
    deductUnpaidLeave: true,
  });
  assert.equal(withDeduction.leaveDeductionPaise, 400000); // ₹4,000
  assert.equal(withDeduction.netPayablePaise, 4780000);
});

test('teacher verification challenge rejects expired, revoked, wrong-branch, and replayed codes', () => {
  const base = {
    isActive: true,
    isRevoked: false,
    expiresAtMs: 2000000,
    nowMs: 1500000,
    challengeBranchId: 1,
    teacherBranchIds: [1],
    applicableTeacherId: null,
    requestingTeacherId: 7,
    usagePolicy: 'SINGLE_USE_GLOBAL' as const,
    alreadyConsumedByTeacher: false,
    totalConsumptionCount: 0,
    codeHashMatches: true,
  };
  assert.equal(validateVerificationChallenge(base).valid, true);
  assert.equal(validateVerificationChallenge({ ...base, nowMs: 2500000 }).valid, false);
  assert.equal(validateVerificationChallenge({ ...base, isRevoked: true }).valid, false);
  assert.equal(validateVerificationChallenge({ ...base, challengeBranchId: 2 }).valid, false);
  assert.equal(validateVerificationChallenge({ ...base, totalConsumptionCount: 1 }).valid, false);
  assert.equal(validateVerificationChallenge({ ...base, codeHashMatches: false }).valid, false);
});

test('syllabus progress deduplicates repeated topic sessions accurately', () => {
  const progress = calculateSyllabusProgress([
    { topicId: 1, status: 'PARTIAL' },
    { topicId: 1, status: 'COMPLETED' }, // revised & completed later -> counts once as COMPLETED
    { topicId: 2, status: 'PARTIAL' },
    { topicId: 3, status: 'PENDING' },
    { topicId: 4, status: 'PENDING' },
  ]);
  assert.equal(progress.totalTopics, 4);
  assert.equal(progress.completedTopics, 1);
  assert.equal(progress.partialTopics, 1);
  assert.equal(progress.pendingTopics, 2);
  assert.equal(progress.coveragePercentage, 37.5);
});

test('examination evaluation validates bounds and computes Indian grade accurately', () => {
  const res = evaluateExamResult(86, 100, 35);
  assert.equal(res.percentage, 86);
  assert.equal(res.grade, 'A2');
  assert.equal(res.passed, true);
  assert.throws(() => evaluateExamResult(105, 100, 35));
});

test('attendance calculation and RBAC branch isolation enforce strict rules', () => {
  const att = calculateAttendanceSummary(['PRESENT', 'PRESENT', 'LATE', 'ABSENT', 'NOT_RECORDED']);
  assert.equal(att.conductedCount, 4);
  assert.equal(att.attendancePercentage, 75);

  // Branch Admin of Branch 1 cannot access Branch 2
  assert.equal(
    canAccessBranchResource(
      RoleCode.BRANCH_ADMIN,
      [Permission.STUDENT_VIEW],
      1,
      2,
      Permission.STUDENT_VIEW
    ),
    false
  );

  // Super Admin can access any branch
  assert.equal(
    canAccessBranchResource(
      RoleCode.SUPER_ADMIN,
      [Permission.STUDENT_VIEW, Permission.BRANCH_SWITCH],
      1,
      2,
      Permission.STUDENT_VIEW
    ),
    true
  );

  // Schedule conflict detection
  const conflict = hasScheduleConflict(
    [{ startTime: '09:00', endTime: '10:30', teacherId: 4, classroom: 'Room 101' }],
    { startTime: '10:00', endTime: '11:30', teacherId: 4, classroom: 'Room 202' }
  );
  assert.equal(conflict.conflict, true);
});
