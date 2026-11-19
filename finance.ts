import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { requirePermission, resolveScopedBranchId } from '../auth';
import { Permission, RoleCode } from '../../shared/types';
import {
  inrToPaise,
  calculateFeeBalance,
  allocatePaymentFIFO,
  calculateTeacherPayroll,
} from '../../shared/domain-logic';
import { writeAuditLog } from '../audit';
import { dispatchNotification } from '../notifications';

export const financeRouter = Router();

// ======================== STUDENT FEE LEDGERS & PAYMENTS ========================
financeRouter.get('/fees/ledger', requirePermission(Permission.FEE_VIEW), (req, res) => {
  const scope = resolveScopedBranchId(req.authUser!, req.query.branchId as string | undefined);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch filter.' });
    return;
  }
  const studentIdFilter = req.query.studentId ? Number(req.query.studentId) : null;
  const db = getDb();
  const todayIso = new Date().toISOString().slice(0, 10);

  let where = 'WHERE 1=1';
  const params: Array<string | number> = [];
  if (scope.branchId !== null) {
    where += ' AND fa.branch_id = ?';
    params.push(scope.branchId);
  }
  if (studentIdFilter) {
    where += ' AND fa.student_id = ?';
    params.push(studentIdFilter);
  }

  const rawAssessments = db
    .prepare(
      `SELECT fa.id, fa.student_id as studentId, s.student_code as studentCode, s.full_name as studentName,
              fa.branch_id as branchId, b.name as branchName, fa.batch_id as batchId, bt.name as batchName,
              fa.title, fa.gross_amount_paise as grossAmountPaise, fa.discount_paise as discountPaise,
              fa.discount_reason as discountReason, fa.adjustment_paise as adjustmentPaise,
              fa.adjustment_reason as adjustmentReason, fa.due_date as dueDate,
              COALESCE((SELECT SUM(pa.allocated_paise) FROM payment_allocations pa WHERE pa.assessment_id = fa.id AND pa.is_reversed = 0), 0) as allocatedPaidPaise,
              COALESCE((SELECT SUM(fr.amount_paise) FROM fee_refunds fr WHERE fr.assessment_id = fa.id), 0) as refundedPaise
       FROM fee_assessments fa
       JOIN students s ON s.id = fa.student_id
       JOIN branches b ON b.id = fa.branch_id
       LEFT JOIN batches bt ON bt.id = fa.batch_id
       ${where}
       ORDER BY fa.due_date ASC, fa.id DESC`
    )
    .all(...params) as Array<{
    id: number;
    studentId: number;
    studentCode: string;
    studentName: string;
    branchId: number;
    branchName: string;
    batchId: number | null;
    batchName: string | null;
    title: string;
    grossAmountPaise: number;
    discountPaise: number;
    discountReason: string;
    adjustmentPaise: number;
    adjustmentReason: string;
    dueDate: string;
    allocatedPaidPaise: number;
    refundedPaise: number;
  }>;

  const assessments = rawAssessments.map((a) => {
    const calc = calculateFeeBalance(
      {
        grossAmountPaise: a.grossAmountPaise,
        discountPaise: a.discountPaise,
        adjustmentPaise: a.adjustmentPaise,
        allocatedPaidPaise: a.allocatedPaidPaise,
        refundedPaise: a.refundedPaise,
      },
      a.dueDate,
      todayIso
    );
    return { ...a, ...calc };
  });

  let payWhere = 'WHERE 1=1';
  const payParams: Array<string | number> = [];
  if (scope.branchId !== null) {
    payWhere += ' AND p.branch_id = ?';
    payParams.push(scope.branchId);
  }
  if (studentIdFilter) {
    payWhere += ' AND p.student_id = ?';
    payParams.push(studentIdFilter);
  }

  const payments = db
    .prepare(
      `SELECT p.id, p.receipt_number as receiptNumber, p.student_id as studentId,
              s.student_code as studentCode, s.full_name as studentName,
              p.branch_id as branchId, b.name as branchName, b.address as branchAddress, b.phone as branchPhone,
              p.amount_paise as amountPaise, p.payment_method as paymentMethod,
              p.reference_no as referenceNo, p.status, p.payment_date as paymentDate, p.notes,
              u.full_name as issuerName, p.reversed_at as reversedAt, p.reversal_reason as reversalReason
       FROM payments p
       JOIN students s ON s.id = p.student_id
       JOIN branches b ON b.id = p.branch_id
       JOIN users u ON u.id = p.received_by_user_id
       ${payWhere}
       ORDER BY p.id DESC LIMIT 120`
    )
    .all(...payParams);

  const feeStructures = db
    .prepare(
      `SELECT id, branch_id as branchId, course_id as courseId, name, fee_category as feeCategory,
              amount_paise as amountPaise, late_fee_paise as lateFeePaise
       FROM fee_structures
       WHERE is_active = 1 ${scope.branchId !== null ? 'AND branch_id = ?' : ''}
       ORDER BY id ASC`
    )
    .all(...(scope.branchId !== null ? [scope.branchId] : []));

  res.json({ assessments, payments, feeStructures });
});

financeRouter.post('/fees/assessments', requirePermission(Permission.FEE_COLLECT, Permission.FEE_ADJUST), (req, res) => {
  const schema = z.object({
    studentId: z.number().int().positive(),
    batchId: z.number().int().positive().nullable().optional(),
    title: z.string().min(3),
    grossAmountInr: z.number().positive(),
    discountInr: z.number().nonnegative().default(0),
    discountReason: z.string().default(''),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const d = parsed.data;
  const db = getDb();
  const stu = db.prepare('SELECT id, branch_id, student_code FROM students WHERE id = ?').get(d.studentId) as
    | { id: number; branch_id: number; student_code: string }
    | undefined;
  if (!stu) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Student not found.' });
    return;
  }
  const scope = resolveScopedBranchId(req.authUser!, stu.branch_id);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Branch restriction.' });
    return;
  }

  const grossPaise = inrToPaise(d.grossAmountInr);
  const discountPaise = inrToPaise(d.discountInr);
  if (discountPaise > grossPaise) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Discount cannot exceed gross fee amount.' });
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO fee_assessments (
        student_id, branch_id, batch_id, title, gross_amount_paise, discount_paise, discount_reason,
        due_date, created_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      d.studentId,
      stu.branch_id,
      d.batchId ?? null,
      d.title.trim(),
      grossPaise,
      discountPaise,
      d.discountReason.trim(),
      d.dueDate,
      req.authUser!.id,
      new Date().toISOString()
    );

  const id = Number(info.lastInsertRowid);
  writeAuditLog({
    actor: req.authUser!,
    branchId: stu.branch_id,
    action: 'FEE_ASSESSMENT_CREATED',
    entityType: 'fee_assessments',
    entityId: id,
    after: d,
  });

  res.status(201).json({ id });
});

financeRouter.patch('/fees/assessments/:id/adjust', requirePermission(Permission.FEE_ADJUST), (req, res) => {
  const assessmentId = Number(req.params.id);
  const schema = z.object({
    discountInr: z.number().nonnegative().optional(),
    discountReason: z.string().optional(),
    adjustmentInr: z.number().optional(),
    adjustmentReason: z.string().min(3, 'Reason required for fee adjustment'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  const before = db.prepare('SELECT * FROM fee_assessments WHERE id = ?').get(assessmentId) as
    | Record<string, unknown>
    | undefined;
  if (!before) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Fee assessment not found.' });
    return;
  }
  const scope = resolveScopedBranchId(req.authUser!, Number(before.branch_id));
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Branch restriction.' });
    return;
  }

  const nextDisc =
    parsed.data.discountInr !== undefined ? inrToPaise(parsed.data.discountInr) : Number(before.discount_paise);
  const nextAdj =
    parsed.data.adjustmentInr !== undefined
      ? inrToPaise(parsed.data.adjustmentInr)
      : Number(before.adjustment_paise);

  db.prepare(
    `UPDATE fee_assessments
     SET discount_paise = ?, discount_reason = COALESCE(?, discount_reason),
         adjustment_paise = ?, adjustment_reason = ?
     WHERE id = ?`
  ).run(nextDisc, parsed.data.discountReason ?? null, nextAdj, parsed.data.adjustmentReason.trim(), assessmentId);

  writeAuditLog({
    actor: req.authUser!,
    branchId: Number(before.branch_id),
    action: 'FEE_ASSESSMENT_ADJUSTED',
    entityType: 'fee_assessments',
    entityId: assessmentId,
    before,
    after: { discountPaise: nextDisc, adjustmentPaise: nextAdj, reason: parsed.data.adjustmentReason },
  });

  res.json({ ok: true });
});

financeRouter.post('/payments', requirePermission(Permission.FEE_COLLECT), (req, res) => {
  const schema = z.object({
    studentId: z.number().int().positive(),
    amountInr: z.number().positive(),
    paymentMethod: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'ONLINE_VERIFIED']),
    referenceNo: z.string().default(''),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().default(''),
    idempotencyKey: z.string().min(6),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const d = parsed.data;
  const db = getDb();

  // Idempotency protection: prevent duplicate payment processing
  const existingPay = db
    .prepare('SELECT id, receipt_number as receiptNumber FROM payments WHERE idempotency_key = ?')
    .get(d.idempotencyKey) as { id: number; receiptNumber: string } | undefined;
  if (existingPay) {
    res.status(200).json({ ...existingPay, deduplicated: true });
    return;
  }

  const stu = db
    .prepare('SELECT id, student_code, full_name, branch_id FROM students WHERE id = ?')
    .get(d.studentId) as
    | { id: number; student_code: string; full_name: string; branch_id: number }
    | undefined;
  if (!stu) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Student not found.' });
    return;
  }
  const scope = resolveScopedBranchId(req.authUser!, stu.branch_id);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Branch restriction.' });
    return;
  }

  const amountPaise = inrToPaise(d.amountInr);
  const todayIso = new Date().toISOString().slice(0, 10);

  // Compute open obligations on server (never trust frontend amounts)
  const rawObligations = db
    .prepare(
      `SELECT fa.id, fa.gross_amount_paise, fa.discount_paise, fa.adjustment_paise, fa.due_date,
              COALESCE((SELECT SUM(pa.allocated_paise) FROM payment_allocations pa WHERE pa.assessment_id = fa.id AND pa.is_reversed = 0), 0) as paid_paise,
              COALESCE((SELECT SUM(fr.amount_paise) FROM fee_refunds fr WHERE fr.assessment_id = fa.id), 0) as refunded_paise
       FROM fee_assessments fa WHERE fa.student_id = ?`
    )
    .all(d.studentId) as Array<{
    id: number;
    gross_amount_paise: number;
    discount_paise: number;
    adjustment_paise: number;
    due_date: string;
    paid_paise: number;
    refunded_paise: number;
  }>;

  const obligations = rawObligations
    .map((o) => {
      const bal = calculateFeeBalance(
        {
          grossAmountPaise: o.gross_amount_paise,
          discountPaise: o.discount_paise,
          adjustmentPaise: o.adjustment_paise,
          allocatedPaidPaise: o.paid_paise,
          refundedPaise: o.refunded_paise,
        },
        o.due_date,
        todayIso
      );
      return {
        assessmentId: o.id,
        dueDateIso: o.due_date,
        outstandingPaise: bal.outstandingPaise,
      };
    })
    .filter((o) => o.outstandingPaise > 0);

  const totalOutstanding = obligations.reduce((acc, o) => acc + o.outstandingPaise, 0);
  if (totalOutstanding === 0) {
    res.status(400).json({
      error: 'NO_OUTSTANDING_OBLIGATION',
      message: 'This student has no unpaid fee assessments to allocate payment against.',
    });
    return;
  }
  if (amountPaise > totalOutstanding) {
    res.status(400).json({
      error: 'OVERPAYMENT_REJECTED',
      message: `Payment exceeds total outstanding balance of ₹${(totalOutstanding / 100).toFixed(2)}.`,
    });
    return;
  }

  const fifo = allocatePaymentFIFO(amountPaise, obligations);
  const nowIso = new Date().toISOString();

  const out = db.transaction(() => {
    const seq = (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as n FROM payments').get() as { n: number }).n;
    const receiptNumber = `RCP-${d.paymentDate.slice(0, 4)}-${String(seq).padStart(4, '0')}`;

    const payRes = db
      .prepare(
        `INSERT INTO payments (
          receipt_number, idempotency_key, student_id, branch_id, amount_paise, payment_method,
          reference_no, status, payment_date, notes, received_by_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?)`
      )
      .run(
        receiptNumber,
        d.idempotencyKey,
        d.studentId,
        stu.branch_id,
        amountPaise,
        d.paymentMethod,
        d.referenceNo.trim(),
        d.paymentDate,
        d.notes.trim(),
        req.authUser!.id,
        nowIso
      );
    const paymentId = Number(payRes.lastInsertRowid);

    const insAlloc = db.prepare(
      'INSERT INTO payment_allocations (payment_id, assessment_id, allocated_paise, is_reversed) VALUES (?, ?, ?, 0)'
    );
    for (const al of fifo.allocations) {
      insAlloc.run(paymentId, al.assessmentId, al.allocatedPaise);
    }

    return { id: paymentId, receiptNumber, allocations: fifo.allocations };
  })();

  writeAuditLog({
    actor: req.authUser!,
    branchId: stu.branch_id,
    action: 'FEE_PAYMENT_POSTED',
    entityType: 'payments',
    entityId: out.receiptNumber,
    after: { studentCode: stu.student_code, amountPaise, method: d.paymentMethod, allocations: out.allocations },
  });

  dispatchNotification({
    branchId: stu.branch_id,
    eventType: 'PAYMENT_RECEIVED',
    title: `Fee Receipt ${out.receiptNumber} Generated`,
    message: `Received ₹${(amountPaise / 100).toFixed(2)} for ${stu.full_name} via ${d.paymentMethod}.`,
    channels: ['IN_APP'],
    dedupeKey: `pay-${out.receiptNumber}`,
    createdByUserId: req.authUser!.id,
  });

  res.status(201).json(out);
});

/**
 * Controlled Reversal Workflow: Never deletes posted financial transactions!
 * Marks payment REVERSED, flips allocation reversal flags, and records immutable audit entry.
 */
financeRouter.post('/payments/:id/reverse', requirePermission(Permission.FEE_ADJUST), (req, res) => {
  const paymentId = Number(req.params.id);
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'A clear reversal reason (min 5 chars) is mandatory for audit integrity.',
    });
    return;
  }
  const db = getDb();
  const pay = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as
    | Record<string, unknown>
    | undefined;
  if (!pay) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Payment record not found.' });
    return;
  }
  if (pay.status === 'REVERSED') {
    res.status(409).json({ error: 'ALREADY_REVERSED', message: 'This payment has already been reversed.' });
    return;
  }
  const scope = resolveScopedBranchId(req.authUser!, Number(pay.branch_id));
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Branch restriction.' });
    return;
  }

  const nowIso = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE payments
       SET status = 'REVERSED', reversed_at = ?, reversal_reason = ?, reversed_by_user_id = ?
       WHERE id = ?`
    ).run(nowIso, reason, req.authUser!.id, paymentId);
    db.prepare('UPDATE payment_allocations SET is_reversed = 1 WHERE payment_id = ?').run(paymentId);
  })();

  writeAuditLog({
    actor: req.authUser!,
    branchId: Number(pay.branch_id),
    action: 'FEE_PAYMENT_REVERSED',
    entityType: 'payments',
    entityId: String(pay.receipt_number),
    before: { status: pay.status, amountPaise: pay.amount_paise },
    after: { status: 'REVERSED', reversalReason: reason },
  });

  res.json({ ok: true });
});

// ======================== SALARY & PAYROLL MANAGEMENT ========================
financeRouter.get('/payroll', requirePermission(Permission.PAYROLL_CALCULATE, Permission.PAYROLL_APPROVE, Permission.PAYROLL_VIEW_OWN), (req, res) => {
  const u = req.authUser!;
  const db = getDb();

  // Teachers with PAYROLL_VIEW_OWN only receive their own payslips, never peer faculty salaries
  if (
    u.roleCode === RoleCode.TEACHER &&
    !u.permissions.includes(Permission.PAYROLL_CALCULATE) &&
    !u.permissions.includes(Permission.PAYROLL_APPROVE)
  ) {
    const myItems = db
      .prepare(
        `SELECT pi.id, pr.period_month as periodMonth, b.name as branchName, pr.status as runStatus,
                pi.salary_model as salaryModel, pi.completed_lectures as completedLectures,
                pi.extra_lectures as extraLectures, pi.present_days as presentDays,
                pi.paid_leave_days as paidLeaveDays, pi.unpaid_leave_days as unpaidLeaveDays,
                pi.earned_base_paise as earnedBasePaise, pi.lecture_earnings_paise as lectureEarningsPaise,
                pi.allowances_paise as allowancesPaise, pi.incentives_paise as incentivesPaise,
                pi.leave_deduction_paise as leaveDeductionPaise, pi.statutory_deduction_paise as statutoryDeductionPaise,
                pi.gross_paise as grossPaise, pi.total_deductions_paise as totalDeductionsPaise,
                pi.net_payable_paise as netPayablePaise, pi.payment_status as paymentStatus,
                pi.disbursed_at as disbursedAt, pi.disbursement_ref as disbursementRef,
                t.full_name as teacherName, t.employee_code as employeeCode
         FROM payroll_items pi
         JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
         JOIN teachers t ON t.id = pi.teacher_id
         JOIN branches b ON b.id = pr.branch_id
         WHERE pi.teacher_id = ?
         ORDER BY pr.period_month DESC`
      )
      .all(u.teacherId ?? -1);
    res.json({ mode: 'OWN_ONLY', runs: [], myPayslips: myItems, structures: [] });
    return;
  }

  const scope = resolveScopedBranchId(u, req.query.branchId as string | undefined);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch.' });
    return;
  }

  const runs = db
    .prepare(
      `SELECT pr.id, pr.period_month as periodMonth, pr.branch_id as branchId, b.name as branchName,
              pr.working_days as workingDays, pr.status, pr.approved_at as approvedAt,
              u1.full_name as calculatedByName, u2.full_name as approvedByName
       FROM payroll_runs pr
       JOIN branches b ON b.id = pr.branch_id
       JOIN users u1 ON u1.id = pr.calculated_by_user_id
       LEFT JOIN users u2 ON u2.id = pr.approved_by_user_id
       ${scope.branchId !== null ? 'WHERE pr.branch_id = ?' : ''}
       ORDER BY pr.period_month DESC, pr.id DESC`
    )
    .all(...(scope.branchId !== null ? [scope.branchId] : [])) as Array<Record<string, unknown>>;

  const enrichedRuns = runs.map((r) => {
    const items = db
      .prepare(
        `SELECT pi.id, pi.teacher_id as teacherId, t.employee_code as employeeCode, t.full_name as teacherName,
                t.designation, pi.salary_model as salaryModel,
                pi.completed_lectures as completedLectures, pi.extra_lectures as extraLectures,
                pi.verified_hours as verifiedHours, pi.present_days as presentDays,
                pi.paid_leave_days as paidLeaveDays, pi.unpaid_leave_days as unpaidLeaveDays,
                pi.missing_checkin_days as missingCheckinDays,
                pi.earned_base_paise as earnedBasePaise, pi.lecture_earnings_paise as lectureEarningsPaise,
                pi.allowances_paise as allowancesPaise, pi.incentives_paise as incentivesPaise,
                pi.reimbursements_paise as reimbursementsPaise,
                pi.leave_deduction_paise as leaveDeductionPaise,
                pi.statutory_deduction_paise as statutoryDeductionPaise,
                pi.approved_deduction_paise as approvedDeductionPaise,
                pi.gross_paise as grossPaise, pi.total_deductions_paise as totalDeductionsPaise,
                pi.net_payable_paise as netPayablePaise, pi.payment_status as paymentStatus,
                pi.disbursed_at as disbursedAt, pi.disbursement_ref as disbursementRef
         FROM payroll_items pi
         JOIN teachers t ON t.id = pi.teacher_id
         WHERE pi.payroll_run_id = ?
         ORDER BY t.full_name ASC`
      )
      .all(Number(r.id));
    return { ...r, items };
  });

  const structures = db
    .prepare(
      `SELECT id, name, model, base_salary_paise as baseSalaryPaise,
              per_lecture_rate_paise as perLectureRatePaise, hourly_rate_paise as hourlyRatePaise,
              allowances_paise as allowancesPaise, statutory_deduction_paise as statutoryDeductionPaise,
              deduct_unpaid_leave as deductUnpaidLeave
       FROM salary_structures ORDER BY id ASC`
    )
    .all();

  res.json({ mode: 'MANAGEMENT', runs: enrichedRuns, myPayslips: [], structures });
});

financeRouter.post('/payroll/calculate', requirePermission(Permission.PAYROLL_CALCULATE), (req, res) => {
  const schema = z.object({
    branchId: z.number().int().positive(),
    periodMonth: z.string().regex(/^\d{4}-\d{2}$/),
    workingDays: z.number().int().min(15).max(31).default(26),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const d = parsed.data;
  const scope = resolveScopedBranchId(req.authUser!, d.branchId);
  if (!scope.allowed || !scope.branchId) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch.' });
    return;
  }

  const db = getDb();
  const existingRun = db
    .prepare('SELECT id, status FROM payroll_runs WHERE period_month = ? AND branch_id = ?')
    .get(d.periodMonth, scope.branchId) as { id: number; status: string } | undefined;

  if (existingRun && existingRun.status !== 'DRAFT') {
    res.status(409).json({
      error: 'PAYROLL_LOCKED',
      message: `Payroll for ${d.periodMonth} is already ${existingRun.status} and cannot be overwritten.`,
    });
    return;
  }

  const teachers = db
    .prepare(
      `SELECT t.id, t.salary_structure_id, ss.model, ss.base_salary_paise, ss.per_lecture_rate_paise,
              ss.hourly_rate_paise, ss.allowances_paise, ss.statutory_deduction_paise, ss.deduct_unpaid_leave
       FROM teachers t
       JOIN salary_structures ss ON ss.id = t.salary_structure_id
       WHERE t.primary_branch_id = ? AND t.status = 'ACTIVE'`
    )
    .all(scope.branchId) as Array<{
    id: number;
    salary_structure_id: number;
    model: 'FIXED_MONTHLY' | 'PER_LECTURE' | 'HOURLY' | 'CONTRACT' | 'BASE_PLUS_INCENTIVE';
    base_salary_paise: number;
    per_lecture_rate_paise: number;
    hourly_rate_paise: number;
    allowances_paise: number;
    statutory_deduction_paise: number;
    deduct_unpaid_leave: number;
  }>;

  const monthPrefix = `${d.periodMonth}-%`;
  const nowIso = new Date().toISOString();

  const runId = db.transaction(() => {
    let rid: number;
    if (existingRun) {
      rid = existingRun.id;
      db.prepare('UPDATE payroll_runs SET working_days = ?, calculated_by_user_id = ? WHERE id = ?').run(
        d.workingDays,
        req.authUser!.id,
        rid
      );
      db.prepare('DELETE FROM payroll_items WHERE payroll_run_id = ?').run(rid);
    } else {
      const ins = db
        .prepare(
          `INSERT INTO payroll_runs (period_month, branch_id, working_days, status, calculated_by_user_id, created_at)
           VALUES (?, ?, ?, 'DRAFT', ?, ?)`
        )
        .run(d.periodMonth, scope.branchId, d.workingDays, req.authUser!.id, nowIso);
      rid = Number(ins.lastInsertRowid);
    }

    for (const t of teachers) {
      const attStats = db
        .prepare(
          `SELECT COUNT(*) as presentDays, COALESCE(SUM(duration_minutes), 0) as totalMins
           FROM teacher_attendance
           WHERE teacher_id = ? AND attendance_date LIKE ?`
        )
        .get(t.id, monthPrefix) as { presentDays: number; totalMins: number };

      const lectures = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM class_sessions
             WHERE conducted_by_teacher_id = ? AND session_date LIKE ? AND status IN ('COMPLETED', 'PARTIALLY_COMPLETED')`
          )
          .get(t.id, monthPrefix) as { c: number }
      ).c;

      const paidLeave = (
        db
          .prepare(
            `SELECT COALESCE(SUM(days_count), 0) as d FROM leave_requests
             WHERE teacher_id = ? AND status = 'APPROVED' AND is_paid = 1 AND start_date LIKE ?`
          )
          .get(t.id, monthPrefix) as { d: number }
      ).d;

      const unpaidLeave = (
        db
          .prepare(
            `SELECT COALESCE(SUM(days_count), 0) as d FROM leave_requests
             WHERE teacher_id = ? AND status = 'APPROVED' AND is_paid = 0 AND start_date LIKE ?`
          )
          .get(t.id, monthPrefix) as { d: number }
      ).d;

      const verifiedHours = Math.round((attStats.totalMins / 60) * 10) / 10;
      const calc = calculateTeacherPayroll({
        model: t.model,
        baseSalaryPaise: t.base_salary_paise,
        perLectureRatePaise: t.per_lecture_rate_paise,
        hourlyRatePaise: t.hourly_rate_paise,
        allowancesPaise: t.allowances_paise,
        incentivesPaise: 0,
        statutoryDeductionPaise: t.statutory_deduction_paise,
        approvedDeductionPaise: 0,
        reimbursementsPaise: 0,
        completedLecturesCount: lectures,
        extraLecturesCount: 0,
        verifiedHoursWorked: verifiedHours,
        workingDaysInPeriod: d.workingDays,
        unpaidLeaveDays: unpaidLeave,
        deductUnpaidLeave: Boolean(t.deduct_unpaid_leave),
      });

      db.prepare(
        `INSERT INTO payroll_items (
          payroll_run_id, teacher_id, salary_model, completed_lectures, extra_lectures,
          verified_hours, present_days, paid_leave_days, unpaid_leave_days, missing_checkin_days,
          earned_base_paise, lecture_earnings_paise, allowances_paise, incentives_paise, reimbursements_paise,
          leave_deduction_paise, statutory_deduction_paise, approved_deduction_paise,
          gross_paise, total_deductions_paise, net_payable_paise, payment_status
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0, ?, ?, 0, ?, ?, ?, 'PENDING')`
      ).run(
        rid,
        t.id,
        t.model,
        lectures,
        verifiedHours,
        attStats.presentDays,
        paidLeave,
        unpaidLeave,
        calc.earnedBasePaise,
        calc.lectureEarningsPaise,
        t.allowances_paise,
        calc.leaveDeductionPaise,
        t.statutory_deduction_paise,
        calc.grossEarningsPaise,
        calc.totalDeductionsPaise,
        calc.netPayablePaise
      );
    }
    return rid;
  })();

  writeAuditLog({
    actor: req.authUser!,
    branchId: scope.branchId,
    action: 'PAYROLL_DRAFT_CALCULATED',
    entityType: 'payroll_runs',
    entityId: runId,
    after: d,
  });

  res.status(201).json({ id: runId });
});

financeRouter.post('/payroll/:id/approve', requirePermission(Permission.PAYROLL_APPROVE), (req, res) => {
  const runId = Number(req.params.id);
  const db = getDb();
  const run = db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(runId) as
    | Record<string, unknown>
    | undefined;
  if (!run) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Payroll run not found.' });
    return;
  }
  db.prepare(
    `UPDATE payroll_runs SET status = 'APPROVED', approved_by_user_id = ?, approved_at = ? WHERE id = ?`
  ).run(req.authUser!.id, new Date().toISOString(), runId);

  writeAuditLog({
    actor: req.authUser!,
    branchId: Number(run.branch_id),
    action: 'PAYROLL_APPROVED',
    entityType: 'payroll_runs',
    entityId: runId,
    before: { status: run.status },
    after: { status: 'APPROVED' },
  });

  res.json({ ok: true });
});

financeRouter.post('/payroll/items/:itemId/disburse', requirePermission(Permission.PAYROLL_APPROVE), (req, res) => {
  const itemId = Number(req.params.itemId);
  const reference = String(req.body?.disbursementRef || '').trim() || `SAL-UTR-${Date.now()}`;
  const db = getDb();
  const item = db
    .prepare(
      `SELECT pi.id, pi.payment_status, pr.status as runStatus, pr.branch_id
       FROM payroll_items pi
       JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
       WHERE pi.id = ?`
    )
    .get(itemId) as
    | { id: number; payment_status: string; runStatus: string; branch_id: number }
    | undefined;

  if (!item) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Payroll item not found.' });
    return;
  }
  if (item.runStatus !== 'APPROVED' && item.runStatus !== 'CLOSED') {
    res.status(400).json({
      error: 'RUN_NOT_APPROVED',
      message: 'Payroll run must be approved by an authorized administrator before salary disbursement.',
    });
    return;
  }

  db.prepare(
    `UPDATE payroll_items SET payment_status = 'DISBURSED', disbursed_at = ?, disbursement_ref = ? WHERE id = ?`
  ).run(new Date().toISOString(), reference, itemId);

  writeAuditLog({
    actor: req.authUser!,
    branchId: item.branch_id,
    action: 'SALARY_DISBURSED',
    entityType: 'payroll_items',
    entityId: itemId,
    after: { disbursementRef: reference },
  });

  res.json({ ok: true, disbursementRef: reference });
});
