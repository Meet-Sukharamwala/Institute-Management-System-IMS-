import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { requirePermission, resolveScopedBranchId } from '../auth';
import { Permission, RoleCode } from '../../shared/types';
import { hashPassword } from '../crypto';
import { inrToPaise, calculateFeeBalance } from '../../shared/domain-logic';
import { writeAuditLog } from '../audit';
import { dispatchNotification } from '../notifications';

export const peopleRouter = Router();

// ======================== STUDENTS ========================
peopleRouter.get('/students', requirePermission(Permission.STUDENT_VIEW), (req, res) => {
  const scope = resolveScopedBranchId(req.authUser!, req.query.branchId as string | undefined);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch filter.' });
    return;
  }
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();
  const batchId = req.query.batchId ? Number(req.query.batchId) : null;
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize || 20)));
  const offset = (page - 1) * pageSize;

  const db = getDb();
  let where = 'WHERE 1=1';
  const params: Array<string | number> = [];

  if (scope.branchId !== null) {
    where += ' AND s.branch_id = ?';
    params.push(scope.branchId);
  }
  // Teachers only see students in their assigned branches
  if (req.authUser!.roleCode === RoleCode.TEACHER && req.authUser!.teacherId) {
    where += ` AND s.branch_id IN (SELECT branch_id FROM teacher_branches WHERE teacher_id = ?)`;
    params.push(req.authUser!.teacherId);
  }
  if (status && status !== 'ALL') {
    where += ' AND s.status = ?';
    params.push(status);
  }
  if (batchId) {
    where += ' AND EXISTS (SELECT 1 FROM enrolments e WHERE e.student_id = s.id AND e.batch_id = ? AND e.status = \'ACTIVE\')';
    params.push(batchId);
  }
  if (search) {
    where += ' AND (s.full_name LIKE ? OR s.student_code LIKE ? OR s.phone LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM students s ${where}`).get(...params) as { c: number }
  ).c;

  const rows = db
    .prepare(
      `SELECT s.id, s.student_code as studentCode, s.full_name as fullName, s.email, s.phone,
              s.academic_level as academicLevel, s.admission_date as admissionDate,
              s.branch_id as branchId, b.name as branchName, s.status, s.enquiry_notes as enquiryNotes
       FROM students s
       JOIN branches b ON b.id = s.branch_id
       ${where}
       ORDER BY s.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as Array<Record<string, unknown>>;

  const todayIso = new Date().toISOString().slice(0, 10);

  const enriched = rows.map((r) => {
    const sid = Number(r.id);
    const batches = db
      .prepare(
        `SELECT bt.id, bt.code, bt.name, e.status as enrolmentStatus
         FROM enrolments e
         JOIN batches bt ON bt.id = e.batch_id
         WHERE e.student_id = ?`
      )
      .all(sid);

    const guardians = db
      .prepare(
        `SELECT g.id, g.full_name as fullName, g.phone, g.email, g.relation_type as relationType
         FROM student_guardians sg
         JOIN guardians g ON g.id = sg.guardian_id
         WHERE sg.student_id = ?`
      )
      .all(sid);

    const assessments = db
      .prepare(
        `SELECT fa.id, fa.gross_amount_paise, fa.discount_paise, fa.adjustment_paise, fa.due_date,
                COALESCE((SELECT SUM(pa.allocated_paise) FROM payment_allocations pa WHERE pa.assessment_id = fa.id AND pa.is_reversed = 0), 0) as paid_paise,
                COALESCE((SELECT SUM(fr.amount_paise) FROM fee_refunds fr WHERE fr.assessment_id = fa.id), 0) as refunded_paise
         FROM fee_assessments fa WHERE fa.student_id = ?`
      )
      .all(sid) as Array<{
      id: number;
      gross_amount_paise: number;
      discount_paise: number;
      adjustment_paise: number;
      due_date: string;
      paid_paise: number;
      refunded_paise: number;
    }>;

    let outstandingPaise = 0;
    let hasOverdue = false;
    for (const a of assessments) {
      const bal = calculateFeeBalance(
        {
          grossAmountPaise: a.gross_amount_paise,
          discountPaise: a.discount_paise,
          adjustmentPaise: a.adjustment_paise,
          allocatedPaidPaise: a.paid_paise,
          refundedPaise: a.refunded_paise,
        },
        a.due_date,
        todayIso
      );
      outstandingPaise += bal.outstandingPaise;
      if (bal.status === 'OVERDUE') hasOverdue = true;
    }

    return {
      ...r,
      batches,
      guardians,
      outstandingPaise,
      hasOverdue,
    };
  });

  res.json({
    students: enriched,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
});

peopleRouter.post('/students', requirePermission(Permission.STUDENT_MANAGE), (req, res) => {
  const schema = z.object({
    fullName: z.string().min(2, 'Student full name is required'),
    email: z.string().email().or(z.literal('')).default(''),
    phone: z.string().min(8, 'Valid contact phone is required'),
    academicLevel: z.string().min(2),
    admissionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    branchId: z.number().int().positive(),
    batchId: z.number().int().positive().optional(),
    guardianName: z.string().optional(),
    guardianPhone: z.string().optional(),
    guardianEmail: z.string().email().or(z.literal('')).optional(),
    guardianRelation: z.string().default('Parent'),
    // Declared Fee Structure at Admission
    admissionFeeInr: z.number().nonnegative().optional(),
    tuitionFeeInr: z.number().nonnegative().optional(),
    materialFeeInr: z.number().nonnegative().optional(),
    initialFeeTitle: z.string().optional(),
    initialFeeInr: z.number().nonnegative().optional(),
    discountInr: z.number().nonnegative().optional(),
    discountReason: z.string().optional(),
    installmentsCount: z.number().int().min(1).max(12).default(1),
    feeDueDate: z.string().optional(),
    initialPaymentInr: z.number().nonnegative().optional(),
    paymentMethod: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE']).optional(),
    createPortalAccounts: z.boolean().default(false),
    portalPassword: z.string().optional(),
    enquiryNotes: z.string().default(''),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const d = parsed.data;
  const scope = resolveScopedBranchId(req.authUser!, d.branchId);
  if (!scope.allowed || !scope.branchId) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Cannot admit student to an unauthorized branch.' });
    return;
  }

  const db = getDb();
  const nowIso = new Date().toISOString();
  const seq = (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM students').get() as { nextId: number }).nextId;
  const studentCode = `STU-${d.admissionDate.slice(0, 4)}-${String(seq).padStart(3, '0')}`;

  const result = db.transaction(() => {
    let studentUserId: number | null = null;
    if (d.createPortalAccounts && d.email && d.portalPassword && d.portalPassword.length >= 8) {
      const sRole = db.prepare('SELECT id FROM roles WHERE code = ?').get(RoleCode.STUDENT) as { id: number };
      const uRes = db
        .prepare(
          `INSERT INTO users (email, password_hash, full_name, phone, role_id, branch_id, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .run(d.email.trim().toLowerCase(), hashPassword(d.portalPassword), d.fullName.trim(), d.phone.trim(), sRole.id, scope.branchId, nowIso);
      studentUserId = Number(uRes.lastInsertRowid);
    }

    const stuRes = db
      .prepare(
        `INSERT INTO students (student_code, user_id, full_name, email, phone, academic_level, admission_date, branch_id, status, enquiry_notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
      )
      .run(
        studentCode,
        studentUserId,
        d.fullName.trim(),
        d.email.trim(),
        d.phone.trim(),
        d.academicLevel.trim(),
        d.admissionDate,
        scope.branchId,
        d.enquiryNotes.trim(),
        nowIso
      );
    const studentId = Number(stuRes.lastInsertRowid);

    if (d.batchId) {
      const batchRow = db.prepare('SELECT id, branch_id, max_capacity FROM batches WHERE id = ?').get(d.batchId) as
        | { id: number; branch_id: number; max_capacity: number }
        | undefined;
      if (!batchRow || batchRow.branch_id !== scope.branchId) {
        throw new Error('Selected batch does not belong to the student branch.');
      }
      db.prepare('INSERT INTO enrolments (student_id, batch_id, enrolled_on, status) VALUES (?, ?, ?, \'ACTIVE\')').run(
        studentId,
        d.batchId,
        d.admissionDate
      );
    }

    if (d.guardianName && d.guardianPhone) {
      let guardianUserId: number | null = null;
      if (d.createPortalAccounts && d.guardianEmail && d.portalPassword && d.portalPassword.length >= 8) {
        const pRole = db.prepare('SELECT id FROM roles WHERE code = ?').get(RoleCode.PARENT) as { id: number };
        const guRes = db
          .prepare(
            `INSERT INTO users (email, password_hash, full_name, phone, role_id, branch_id, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
          )
          .run(d.guardianEmail.trim().toLowerCase(), hashPassword(d.portalPassword), d.guardianName.trim(), d.guardianPhone.trim(), pRole.id, scope.branchId, nowIso);
        guardianUserId = Number(guRes.lastInsertRowid);
      }

      const gRes = db
        .prepare(
          `INSERT INTO guardians (user_id, full_name, phone, email, relation_type, comm_preference, created_at)
           VALUES (?, ?, ?, ?, ?, 'IN_APP_EMAIL', ?)`
        )
        .run(guardianUserId, d.guardianName.trim(), d.guardianPhone.trim(), d.guardianEmail?.trim() || '', d.guardianRelation, nowIso);
      db.prepare('INSERT INTO student_guardians (student_id, guardian_id, is_primary) VALUES (?, ?, 1)').run(
        studentId,
        Number(gRes.lastInsertRowid)
      );
    }

    let receiptNumber: string | null = null;
    const totalDeclaredInr =
      (d.admissionFeeInr !== undefined || d.tuitionFeeInr !== undefined || d.materialFeeInr !== undefined)
        ? ((d.admissionFeeInr || 0) + (d.tuitionFeeInr || 0) + (d.materialFeeInr || 0))
        : (d.initialFeeInr || 0);

    const discountInr = Math.min(totalDeclaredInr, d.discountInr || 0);
    const netPayableInr = Math.max(0, totalDeclaredInr - discountInr);
    const createdAssessmentIds: number[] = [];

    if (totalDeclaredInr > 0) {
      const numInstallments = Math.max(1, d.installmentsCount || 1);
      const baseDueDate = d.feeDueDate || d.admissionDate;

      if (numInstallments > 1 && netPayableInr > 0) {
        const baseInstInr = Math.floor(netPayableInr / numInstallments);
        for (let i = 1; i <= numInstallments; i++) {
          const isLast = i === numInstallments;
          const instInr = isLast ? netPayableInr - baseInstInr * (numInstallments - 1) : baseInstInr;
          const offsetDays = (i - 1) * 30;
          const instDate = new Date(new Date(baseDueDate).getTime() + offsetDays * 86400000).toISOString().slice(0, 10);
          const instTitle = d.initialFeeTitle?.trim()
            ? `${d.initialFeeTitle.trim()} — Instalment ${i} of ${numInstallments}`
            : `Declared Fee — Instalment ${i} of ${numInstallments} (${d.academicLevel})`;

          const resA = db
            .prepare(
              `INSERT INTO fee_assessments (student_id, branch_id, batch_id, title, gross_amount_paise, discount_paise, discount_reason, due_date, created_by_user_id, created_at)
               VALUES (?, ?, ?, ?, ?, 0, '', ?, ?, ?)`
            )
            .run(
              studentId,
              scope.branchId,
              d.batchId ?? null,
              instTitle,
              inrToPaise(instInr),
              instDate,
              req.authUser!.id,
              nowIso
            );
          createdAssessmentIds.push(Number(resA.lastInsertRowid));
        }
      } else {
        // Single Assessment
        const title = d.initialFeeTitle?.trim() || `Declared Fee: ${d.academicLevel} Course & Admission Fee`;
        const resA = db
          .prepare(
            `INSERT INTO fee_assessments (student_id, branch_id, batch_id, title, gross_amount_paise, discount_paise, discount_reason, due_date, created_by_user_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            studentId,
            scope.branchId,
            d.batchId ?? null,
            title,
            inrToPaise(totalDeclaredInr),
            inrToPaise(discountInr),
            d.discountReason?.trim() || (discountInr > 0 ? 'Admission Concession / Scholarship' : ''),
            baseDueDate,
            req.authUser!.id,
            nowIso
          );
        createdAssessmentIds.push(Number(resA.lastInsertRowid));
      }

      // Initial Payment Allocation
      if (d.initialPaymentInr && d.initialPaymentInr > 0) {
        let remainingToAllocate = inrToPaise(d.initialPaymentInr);
        if (remainingToAllocate > 0 && createdAssessmentIds.length > 0) {
          const pSeq = (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as n FROM payments').get() as { n: number }).n;
          receiptNumber = `RCP-${d.admissionDate.slice(0, 4)}-${String(pSeq).padStart(4, '0')}`;
          const payRes = db
            .prepare(
              `INSERT INTO payments (receipt_number, idempotency_key, student_id, branch_id, amount_paise, payment_method, reference_no, status, payment_date, notes, received_by_user_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'ADMISSION-DESK', 'POSTED', ?, 'Initial admission payment', ?, ?)`
            )
            .run(
              receiptNumber,
              `adm-pay-${studentCode}-${Date.now()}`,
              studentId,
              scope.branchId,
              remainingToAllocate,
              d.paymentMethod || 'UPI',
              d.admissionDate,
              req.authUser!.id,
              nowIso
            );
          const payId = Number(payRes.lastInsertRowid);

          for (const assessId of createdAssessmentIds) {
            if (remainingToAllocate <= 0) break;
            const assessRow = db.prepare('SELECT gross_amount_paise - discount_paise as netPaise FROM fee_assessments WHERE id = ?').get(assessId) as { netPaise: number };
            const alloc = Math.min(remainingToAllocate, assessRow.netPaise);
            db.prepare(
              'INSERT INTO payment_allocations (payment_id, assessment_id, allocated_paise, is_reversed) VALUES (?, ?, ?, 0)'
            ).run(payId, assessId, alloc);
            remainingToAllocate -= alloc;
          }
        }
      }
    }

    return { studentId, studentCode, receiptNumber };
  })();

  writeAuditLog({
    actor: req.authUser!,
    branchId: scope.branchId,
    action: 'STUDENT_ADMITTED',
    entityType: 'students',
    entityId: result.studentCode,
    after: { fullName: d.fullName, batchId: d.batchId, receiptNumber: result.receiptNumber },
  });

  dispatchNotification({
    branchId: scope.branchId,
    eventType: 'ADMISSION_COMPLETED',
    title: `Admission Confirmed: ${d.fullName} (${result.studentCode})`,
    message: `${d.fullName} has been registered in ${d.academicLevel}.${result.receiptNumber ? ` Receipt ${result.receiptNumber} generated.` : ''}`,
    channels: ['IN_APP', 'EMAIL'],
    dedupeKey: `adm-${result.studentCode}`,
    createdByUserId: req.authUser!.id,
  });

  res.status(201).json(result);
});

peopleRouter.patch('/students/:id/lifecycle', requirePermission(Permission.STUDENT_MANAGE), (req, res) => {
  const studentId = Number(req.params.id);
  const schema = z.object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'WITHDRAWN', 'COMPLETED', 'TRANSFERRED']),
    targetBranchId: z.number().int().positive().optional(),
    enrolBatchId: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  const stu = db.prepare('SELECT id, student_code, branch_id, status FROM students WHERE id = ?').get(studentId) as
    | { id: number; student_code: string; branch_id: number; status: string }
    | undefined;
  if (!stu) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Student not found.' });
    return;
  }
  const scope = resolveScopedBranchId(req.authUser!, stu.branch_id);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Cross-branch student modification denied.' });
    return;
  }

  db.transaction(() => {
    if (parsed.data.targetBranchId && req.authUser!.roleCode === RoleCode.SUPER_ADMIN) {
      db.prepare('UPDATE students SET branch_id = ?, status = ? WHERE id = ?').run(
        parsed.data.targetBranchId,
        parsed.data.status,
        studentId
      );
    } else {
      db.prepare('UPDATE students SET status = ? WHERE id = ?').run(parsed.data.status, studentId);
    }

    if (parsed.data.enrolBatchId) {
      db.prepare(
        `INSERT OR IGNORE INTO enrolments (student_id, batch_id, enrolled_on, status)
         VALUES (?, ?, ?, 'ACTIVE')`
      ).run(studentId, parsed.data.enrolBatchId, new Date().toISOString().slice(0, 10));
    }
  })();

  writeAuditLog({
    actor: req.authUser!,
    branchId: stu.branch_id,
    action: 'STUDENT_LIFECYCLE_UPDATED',
    entityType: 'students',
    entityId: stu.student_code,
    before: { status: stu.status, branchId: stu.branch_id },
    after: parsed.data,
  });

  res.json({ ok: true });
});

// ======================== TEACHERS & STAFF ========================
peopleRouter.get('/teachers', requirePermission(Permission.TEACHER_VIEW), (req, res) => {
  const scope = resolveScopedBranchId(req.authUser!, req.query.branchId as string | undefined);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch filter.' });
    return;
  }
  const search = String(req.query.search || '').trim();
  const db = getDb();

  let where = 'WHERE 1=1';
  const params: Array<string | number> = [];
  if (scope.branchId !== null) {
    where += ` AND (t.primary_branch_id = ? OR EXISTS (SELECT 1 FROM teacher_branches tb WHERE tb.teacher_id = t.id AND tb.branch_id = ?))`;
    params.push(scope.branchId, scope.branchId);
  }
  if (search) {
    where += ' AND (t.full_name LIKE ? OR t.employee_code LIKE ? OR t.subjects_csv LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const canSeeSalary = req.authUser!.permissions.includes(Permission.PAYROLL_CALCULATE) ||
    req.authUser!.permissions.includes(Permission.PAYROLL_APPROVE);

  const teachers = db
    .prepare(
      `SELECT t.id, t.employee_code as employeeCode, t.user_id as userId, t.full_name as fullName,
              t.email, t.phone, t.designation, t.employment_type as employmentType,
              t.joining_date as joiningDate, t.primary_branch_id as primaryBranchId,
              b.name as primaryBranchName, t.subjects_csv as subjectsCsv,
              t.salary_structure_id as salaryStructureId, ss.name as salaryStructureName,
              ss.model as salaryModel, ss.base_salary_paise as baseSalaryPaise,
              ss.per_lecture_rate_paise as perLectureRatePaise, ss.hourly_rate_paise as hourlyRatePaise,
              ss.allowances_paise as allowancesPaise, ss.statutory_deduction_paise as statutoryDeductionPaise,
              ss.deduct_unpaid_leave as deductUnpaidLeave,
              t.status, t.documents_notes as documentsNotes
       FROM teachers t
       JOIN branches b ON b.id = t.primary_branch_id
       LEFT JOIN salary_structures ss ON ss.id = t.salary_structure_id
       ${where}
       ORDER BY t.id ASC`
    )
    .all(...params) as Array<Record<string, unknown>>;

  const sanitized = teachers.map((t) => {
    const tid = Number(t.id);
    const assignedBranches = db
      .prepare(
        `SELECT b.id, b.code, b.name FROM teacher_branches tb JOIN branches b ON b.id = tb.branch_id WHERE tb.teacher_id = ?`
      )
      .all(tid);
    const assignedBatches = db
      .prepare(
        `SELECT bt.id, bt.code, bt.name, sub.name as subjectName
         FROM batch_teachers btr
         JOIN batches bt ON bt.id = btr.batch_id
         JOIN subjects sub ON sub.id = btr.subject_id
         WHERE btr.teacher_id = ?`
      )
      .all(tid);

    if (!canSeeSalary) {
      delete t.baseSalaryPaise;
      delete t.perLectureRatePaise;
      delete t.hourlyRatePaise;
      delete t.allowancesPaise;
      delete t.statutoryDeductionPaise;
      delete t.salaryStructureName;
      delete t.salaryModel;
    }
    return { ...t, assignedBranches, assignedBatches };
  });

  const salaryStructures = canSeeSalary
    ? db
        .prepare(
          `SELECT id, name, model, base_salary_paise as baseSalaryPaise,
                  per_lecture_rate_paise as perLectureRatePaise, allowances_paise as allowancesPaise
           FROM salary_structures ORDER BY id ASC`
        )
        .all()
    : [];

  res.json({ teachers: sanitized, salaryStructures });
});

peopleRouter.post('/teachers', requirePermission(Permission.TEACHER_MANAGE), (req, res) => {
  const schema = z.object({
    fullName: z.string().min(2),
    email: z.string().email(),
    phone: z.string().min(8),
    designation: z.string().min(2),
    employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'VISITING', 'CONTRACT']),
    joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    primaryBranchId: z.number().int().positive(),
    additionalBranchIds: z.array(z.number().int().positive()).default([]),
    subjectsCsv: z.string().min(2),
    // Existing template ID or custom salary fields entered during onboarding
    salaryStructureId: z.number().int().positive().nullable().optional(),
    salaryModel: z.enum(['FIXED_MONTHLY', 'PER_LECTURE', 'HOURLY']).optional(),
    baseSalaryInr: z.number().nonnegative().optional(),
    perLectureRateInr: z.number().nonnegative().optional(),
    hourlyRateInr: z.number().nonnegative().optional(),
    allowancesInr: z.number().nonnegative().optional(),
    statutoryDeductionInr: z.number().nonnegative().optional(),
    deductUnpaidLeave: z.boolean().default(true),
    customSalaryName: z.string().optional(),
    portalPassword: z.string().min(8).default('Ims@2026!Secure'),
    documentsNotes: z.string().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const d = parsed.data;
  const scope = resolveScopedBranchId(req.authUser!, d.primaryBranchId);
  if (!scope.allowed || !scope.branchId) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Cannot create faculty in unauthorized branch.' });
    return;
  }

  const db = getDb();
  const nowIso = new Date().toISOString();
  const seq = (db.prepare('SELECT COALESCE(MAX(id), 100) + 1 as n FROM teachers').get() as { n: number }).n;
  const employeeCode = `EMP-${seq}`;
  const teacherRole = db.prepare('SELECT id FROM roles WHERE code = ?').get(RoleCode.TEACHER) as { id: number };

  try {
    const out = db.transaction(() => {
      // 1. Create dedicated custom salary structure if compensation values are entered
      let finalSalaryStructureId: number | null = d.salaryStructureId ?? null;
      if (d.salaryModel) {
        const model = d.salaryModel;
        const structName =
          d.customSalaryName?.trim() ||
          `${d.fullName.trim()} (${employeeCode}) — ${model === 'FIXED_MONTHLY' ? 'Monthly' : model === 'PER_LECTURE' ? 'Per-Lecture' : 'Hourly'} Structure`;
        const ssRes = db
          .prepare(
            `INSERT INTO salary_structures (name, model, base_salary_paise, per_lecture_rate_paise, hourly_rate_paise, allowances_paise, statutory_deduction_paise, deduct_unpaid_leave, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            structName,
            model,
            inrToPaise(d.baseSalaryInr || 0),
            inrToPaise(d.perLectureRateInr || 0),
            inrToPaise(d.hourlyRateInr || 0),
            inrToPaise(d.allowancesInr || 0),
            inrToPaise(d.statutoryDeductionInr || 0),
            d.deductUnpaidLeave ? 1 : 0,
            nowIso
          );
        finalSalaryStructureId = Number(ssRes.lastInsertRowid);
      }

      // 2. Create user account
      const uRes = db
        .prepare(
          `INSERT INTO users (email, password_hash, full_name, phone, role_id, branch_id, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .run(
          d.email.trim().toLowerCase(),
          hashPassword(d.portalPassword),
          d.fullName.trim(),
          d.phone.trim(),
          teacherRole.id,
          scope.branchId,
          nowIso
        );
      const userId = Number(uRes.lastInsertRowid);

      // 3. Create teacher profile linked to salary structure
      const tRes = db
        .prepare(
          `INSERT INTO teachers (employee_code, user_id, full_name, email, phone, designation, employment_type, joining_date, primary_branch_id, subjects_csv, salary_structure_id, status, documents_notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
        )
        .run(
          employeeCode,
          userId,
          d.fullName.trim(),
          d.email.trim().toLowerCase(),
          d.phone.trim(),
          d.designation.trim(),
          d.employmentType,
          d.joiningDate,
          scope.branchId,
          d.subjectsCsv.trim(),
          finalSalaryStructureId,
          d.documentsNotes.trim(),
          nowIso
        );
      const teacherId = Number(tRes.lastInsertRowid);

      const branchSet = new Set<number>([scope.branchId!, ...d.additionalBranchIds]);
      const insTb = db.prepare('INSERT OR IGNORE INTO teacher_branches (teacher_id, branch_id) VALUES (?, ?)');
      for (const bid of branchSet) {
        insTb.run(teacherId, bid);
      }
      return { teacherId, employeeCode, salaryStructureId: finalSalaryStructureId };
    })();

    writeAuditLog({
      actor: req.authUser!,
      branchId: scope.branchId,
      action: 'TEACHER_CREATED',
      entityType: 'teachers',
      entityId: out.employeeCode,
      after: { fullName: d.fullName, designation: d.designation, primaryBranchId: scope.branchId, salaryStructureId: out.salaryStructureId },
    });

    res.status(201).json(out);
  } catch {
    res.status(409).json({ error: 'CONFLICT', message: 'A user or faculty member with this email already exists.' });
  }
});

peopleRouter.patch('/teachers/:id/salary-structure', requirePermission(Permission.PAYROLL_APPROVE), (req, res) => {
  const teacherId = Number(req.params.id);
  const schema = z.object({
    salaryModel: z.enum(['FIXED_MONTHLY', 'PER_LECTURE', 'HOURLY']),
    baseSalaryInr: z.number().nonnegative().optional(),
    perLectureRateInr: z.number().nonnegative().optional(),
    hourlyRateInr: z.number().nonnegative().optional(),
    allowancesInr: z.number().nonnegative().optional(),
    statutoryDeductionInr: z.number().nonnegative().optional(),
    deductUnpaidLeave: z.boolean().default(true),
    structureName: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const d = parsed.data;
  const db = getDb();
  const t = db.prepare('SELECT id, employee_code, full_name, primary_branch_id, salary_structure_id FROM teachers WHERE id = ?').get(teacherId) as
    | { id: number; employee_code: string; full_name: string; primary_branch_id: number; salary_structure_id: number | null }
    | undefined;

  if (!t) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Faculty member not found.' });
    return;
  }

  const nowIso = new Date().toISOString();
  db.transaction(() => {
    let ssId = t.salary_structure_id;
    const name = d.structureName?.trim() || `${t.full_name} (${t.employee_code}) Compensation`;
    if (ssId) {
      db.prepare(
        `UPDATE salary_structures
         SET name = ?, model = ?, base_salary_paise = ?, per_lecture_rate_paise = ?, hourly_rate_paise = ?,
             allowances_paise = ?, statutory_deduction_paise = ?, deduct_unpaid_leave = ?
         WHERE id = ?`
      ).run(
        name,
        d.salaryModel,
        inrToPaise(d.baseSalaryInr || 0),
        inrToPaise(d.perLectureRateInr || 0),
        inrToPaise(d.hourlyRateInr || 0),
        inrToPaise(d.allowancesInr || 0),
        inrToPaise(d.statutoryDeductionInr || 0),
        d.deductUnpaidLeave ? 1 : 0,
        ssId
      );
    } else {
      const insRes = db
        .prepare(
          `INSERT INTO salary_structures (name, model, base_salary_paise, per_lecture_rate_paise, hourly_rate_paise, allowances_paise, statutory_deduction_paise, deduct_unpaid_leave, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          name,
          d.salaryModel,
          inrToPaise(d.baseSalaryInr || 0),
          inrToPaise(d.perLectureRateInr || 0),
          inrToPaise(d.hourlyRateInr || 0),
          inrToPaise(d.allowancesInr || 0),
          inrToPaise(d.statutoryDeductionInr || 0),
          d.deductUnpaidLeave ? 1 : 0,
          nowIso
        );
      ssId = Number(insRes.lastInsertRowid);
      db.prepare('UPDATE teachers SET salary_structure_id = ? WHERE id = ?').run(ssId, teacherId);
    }
  })();

  writeAuditLog({
    actor: req.authUser!,
    branchId: t.primary_branch_id,
    action: 'FACULTY_SALARY_STRUCTURE_UPDATED',
    entityType: 'teachers',
    entityId: t.employee_code,
    after: d,
  });

  res.json({ ok: true });
});

peopleRouter.patch('/teachers/:id/status', requirePermission(Permission.TEACHER_MANAGE), (req, res) => {
  const teacherId = Number(req.params.id);
  const schema = z.object({
    status: z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE']),
    transferPrimaryBranchId: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  const t = db
    .prepare('SELECT id, employee_code, user_id, primary_branch_id, status FROM teachers WHERE id = ?')
    .get(teacherId) as
    | { id: number; employee_code: string; user_id: number | null; primary_branch_id: number; status: string }
    | undefined;
  if (!t) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Teacher not found.' });
    return;
  }
  const scope = resolveScopedBranchId(req.authUser!, t.primary_branch_id);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Cross-branch modification denied.' });
    return;
  }

  db.transaction(() => {
    const nextBranch =
      parsed.data.transferPrimaryBranchId && req.authUser!.roleCode === RoleCode.SUPER_ADMIN
        ? parsed.data.transferPrimaryBranchId
        : t.primary_branch_id;
    db.prepare('UPDATE teachers SET status = ?, primary_branch_id = ? WHERE id = ?').run(
      parsed.data.status,
      nextBranch,
      teacherId
    );
    db.prepare('INSERT OR IGNORE INTO teacher_branches (teacher_id, branch_id) VALUES (?, ?)').run(
      teacherId,
      nextBranch
    );
    if (t.user_id) {
      const activeFlag = parsed.data.status === 'INACTIVE' ? 0 : 1;
      db.prepare('UPDATE users SET is_active = ?, branch_id = ? WHERE id = ?').run(
        activeFlag,
        nextBranch,
        t.user_id
      );
      if (!activeFlag) {
        db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ?').run(
          new Date().toISOString(),
          t.user_id
        );
      }
    }
  })();

  writeAuditLog({
    actor: req.authUser!,
    branchId: t.primary_branch_id,
    action: 'TEACHER_STATUS_UPDATED',
    entityType: 'teachers',
    entityId: t.employee_code,
    before: { status: t.status, primaryBranchId: t.primary_branch_id },
    after: parsed.data,
  });

  res.json({ ok: true });
});
