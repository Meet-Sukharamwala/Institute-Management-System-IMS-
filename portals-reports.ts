import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { requireAuth, requirePermission, resolveScopedBranchId } from '../auth';
import { Permission, RoleCode } from '../../shared/types';
import {
  calculateFeeBalance,
  calculateAttendanceSummary,
  calculateSyllabusProgress,
  paiseToInrString,
} from '../../shared/domain-logic';
import { dispatchNotification, isProviderLive } from '../notifications';
import { writeAuditLog } from '../audit';

export const portalsReportsRouter = Router();

// ======================== OPERATIONAL DASHBOARD ========================
portalsReportsRouter.get('/dashboard', requirePermission(Permission.DASHBOARD_VIEW), (req, res) => {
  const scope = resolveScopedBranchId(req.authUser!, req.query.branchId as string | undefined);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch filter.' });
    return;
  }
  const dateStr = String(req.query.date || new Date().toISOString().slice(0, 10)).trim();
  const monthPrefix = `${dateStr.slice(0, 7)}-%`;
  const bId = scope.branchId;
  const db = getDb();

  // 1. Student statistics
  const activeStudents = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM students WHERE status = 'ACTIVE' ${bId ? 'AND branch_id = ?' : ''}`
      )
      .get(...(bId ? [bId] : [])) as { c: number }
  ).c;

  const newAdmissions = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM students WHERE admission_date LIKE ? ${bId ? 'AND branch_id = ?' : ''}`
      )
      .get(monthPrefix, ...(bId ? [bId] : [])) as { c: number }
  ).c;

  const attTodayRows = db
    .prepare(
      `SELECT sa.status, COUNT(*) as c
       FROM student_attendance sa
       JOIN class_sessions cs ON cs.id = sa.class_session_id
       WHERE cs.session_date = ? ${bId ? 'AND cs.branch_id = ?' : ''}
       GROUP BY sa.status`
    )
    .all(dateStr, ...(bId ? [bId] : [])) as Array<{ status: string; c: number }>;

  let presentToday = 0;
  let absentToday = 0;
  for (const r of attTodayRows) {
    if (r.status === 'PRESENT' || r.status === 'LATE') presentToday += r.c;
    if (r.status === 'ABSENT') absentToday += r.c;
  }

  const studentsOnLeave = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT student_id) as c FROM leave_requests
         WHERE applicant_type = 'STUDENT' AND status = 'APPROVED'
           AND start_date <= ? AND end_date >= ? ${bId ? 'AND branch_id = ?' : ''}`
      )
      .get(dateStr, dateStr, ...(bId ? [bId] : [])) as { c: number }
  ).c;

  // 2. Teacher statistics
  const activeTeachers = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM teachers WHERE status = 'ACTIVE' ${bId ? 'AND primary_branch_id = ?' : ''}`
      )
      .get(...(bId ? [bId] : [])) as { c: number }
  ).c;

  const teacherAttRows = db
    .prepare(
      `SELECT status, COUNT(*) as c FROM teacher_attendance
       WHERE attendance_date = ? ${bId ? 'AND branch_id = ?' : ''}
       GROUP BY status`
    )
    .all(dateStr, ...(bId ? [bId] : [])) as Array<{ status: string; c: number }>;

  let teachersCheckedIn = 0;
  let teachersCheckedOut = 0;
  for (const r of teacherAttRows) {
    if (r.status === 'CHECKED_IN') teachersCheckedIn += r.c;
    if (r.status === 'CHECKED_OUT' || r.status === 'MANUAL_OVERRIDE' || r.status === 'EXCEPTION_FLAGGED') {
      teachersCheckedOut += r.c;
    }
  }
  const teachersNotCheckedIn = Math.max(0, activeTeachers - (teachersCheckedIn + teachersCheckedOut));

  // 3. Academic statistics
  const sessionStats = db
    .prepare(
      `SELECT cs.status, COUNT(*) as c,
              SUM(CASE WHEN tr.id IS NULL AND cs.status IN ('IN_PROGRESS', 'SCHEDULED') THEN 1 ELSE 0 END) as missingRec
       FROM class_sessions cs
       LEFT JOIN teaching_records tr ON tr.class_session_id = cs.id
       WHERE cs.session_date = ? ${bId ? 'AND cs.branch_id = ?' : ''}
       GROUP BY cs.status`
    )
    .all(dateStr, ...(bId ? [bId] : [])) as Array<{ status: string; c: number; missingRec: number }>;

  let classesScheduledToday = 0;
  let classesInProgress = 0;
  let classesCompleted = 0;
  let classesCancelledOrRescheduled = 0;
  let missingTeachingRecords = 0;

  for (const s of sessionStats) {
    classesScheduledToday += s.c;
    if (s.status === 'IN_PROGRESS') classesInProgress += s.c;
    if (s.status === 'COMPLETED' || s.status === 'PARTIALLY_COMPLETED') classesCompleted += s.c;
    if (s.status === 'CANCELLED' || s.status === 'RESCHEDULED') classesCancelledOrRescheduled += s.c;
    missingTeachingRecords += s.missingRec || 0;
  }

  const pendingTopics = (
    db
      .prepare(
        `SELECT COUNT(*) as c
         FROM syllabus_topics st
         JOIN subjects sub ON sub.id = st.subject_id
         JOIN courses c ON c.id = sub.course_id
         WHERE 1=1 ${bId ? 'AND c.branch_id = ?' : ''}
           AND NOT EXISTS (
             SELECT 1 FROM batch_topic_progress btp
             WHERE btp.topic_id = st.id AND btp.status = 'COMPLETED'
           )`
      )
      .get(...(bId ? [bId] : [])) as { c: number }
  ).c;

  // 4. Financial statistics (confirmed POSTED vs pending/overdue)
  const canSeeFinance =
    req.authUser!.permissions.includes(Permission.FEE_VIEW) ||
    req.authUser!.roleCode === RoleCode.SUPER_ADMIN ||
    req.authUser!.roleCode === RoleCode.BRANCH_ADMIN;

  let todayCollectionPaise = 0;
  let monthlyCollectionPaise = 0;
  let outstandingFeesPaise = 0;
  let studentsWithOverdueFees = 0;
  let pendingSalaryPaise = 0;
  let approvedPayrollPaise = 0;

  if (canSeeFinance) {
    todayCollectionPaise = (
      db
        .prepare(
          `SELECT COALESCE(SUM(amount_paise), 0) as s FROM payments
           WHERE status = 'POSTED' AND payment_date = ? ${bId ? 'AND branch_id = ?' : ''}`
        )
        .get(dateStr, ...(bId ? [bId] : [])) as { s: number }
    ).s;

    monthlyCollectionPaise = (
      db
        .prepare(
          `SELECT COALESCE(SUM(amount_paise), 0) as s FROM payments
           WHERE status = 'POSTED' AND payment_date LIKE ? ${bId ? 'AND branch_id = ?' : ''}`
        )
        .get(monthPrefix, ...(bId ? [bId] : [])) as { s: number }
    ).s;

    const allAssessments = db
      .prepare(
        `SELECT fa.student_id, fa.gross_amount_paise, fa.discount_paise, fa.adjustment_paise, fa.due_date,
                COALESCE((SELECT SUM(pa.allocated_paise) FROM payment_allocations pa WHERE pa.assessment_id = fa.id AND pa.is_reversed = 0), 0) as paid,
                COALESCE((SELECT SUM(fr.amount_paise) FROM fee_refunds fr WHERE fr.assessment_id = fa.id), 0) as refunded
         FROM fee_assessments fa
         ${bId ? 'WHERE fa.branch_id = ?' : ''}`
      )
      .all(...(bId ? [bId] : [])) as Array<{
      student_id: number;
      gross_amount_paise: number;
      discount_paise: number;
      adjustment_paise: number;
      due_date: string;
      paid: number;
      refunded: number;
    }>;

    const overdueStudentSet = new Set<number>();
    for (const a of allAssessments) {
      const bal = calculateFeeBalance(
        {
          grossAmountPaise: a.gross_amount_paise,
          discountPaise: a.discount_paise,
          adjustmentPaise: a.adjustment_paise,
          allocatedPaidPaise: a.paid,
          refundedPaise: a.refunded,
        },
        a.due_date,
        dateStr
      );
      outstandingFeesPaise += bal.outstandingPaise;
      if (bal.status === 'OVERDUE') overdueStudentSet.add(a.student_id);
    }
    studentsWithOverdueFees = overdueStudentSet.size;

    pendingSalaryPaise = (
      db
        .prepare(
          `SELECT COALESCE(SUM(pi.net_payable_paise), 0) as s
           FROM payroll_items pi
           JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
           WHERE pi.payment_status = 'PENDING' ${bId ? 'AND pr.branch_id = ?' : ''}`
        )
        .get(...(bId ? [bId] : [])) as { s: number }
    ).s;

    approvedPayrollPaise = (
      db
        .prepare(
          `SELECT COALESCE(SUM(pi.net_payable_paise), 0) as s
           FROM payroll_items pi
           JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
           WHERE pr.status IN ('APPROVED', 'CLOSED') ${bId ? 'AND pr.branch_id = ?' : ''}`
        )
        .get(...(bId ? [bId] : [])) as { s: number }
    ).s;
  }

  // Alerts: missing exits, pending leave approvals, overdue fees
  const missingExitsCount = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM student_movements
         WHERE exit_time IS NULL ${bId ? 'AND branch_id = ?' : ''}`
      )
      .get(...(bId ? [bId] : [])) as { c: number }
  ).c;

  const pendingLeavesCount = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM leave_requests
         WHERE status = 'PENDING' ${bId ? 'AND branch_id = ?' : ''}`
      )
      .get(...(bId ? [bId] : [])) as { c: number }
  ).c;

  // Chart data: Branch-wise or Batch-wise performance & collection
  const batchChart = db
    .prepare(
      `SELECT bt.code as batchCode, bt.name as batchName,
              (SELECT COUNT(*) FROM enrolments e WHERE e.batch_id = bt.id AND e.status = 'ACTIVE') as students,
              COALESCE((
                SELECT ROUND(AVG(er.percentage), 1)
                FROM exam_results er
                JOIN examinations ex ON ex.id = er.examination_id
                WHERE ex.batch_id = bt.id
              ), 0) as avgExamScore
       FROM batches bt
       ${bId ? 'WHERE bt.branch_id = ?' : ''}
       ORDER BY bt.id ASC`
    )
    .all(...(bId ? [bId] : []));

  const recentAudit = db
    .prepare(
      `SELECT id, actor_name as actorName, actor_role as actorRole, action, entity_type as entityType,
              entity_id as entityId, created_at as createdAt
       FROM audit_logs
       ${bId ? 'WHERE branch_id = ?' : ''}
       ORDER BY id DESC LIMIT 8`
    )
    .all(...(bId ? [bId] : []));

  res.json({
    date: dateStr,
    studentStats: {
      activeStudents,
      newAdmissions,
      presentToday,
      absentToday,
      studentsWithOverdueFees,
      studentsOnLeave,
    },
    teacherStats: {
      activeTeachers,
      teachersCheckedIn,
      teachersCheckedOut,
      teachersNotCheckedIn,
    },
    academicStats: {
      classesScheduledToday,
      classesInProgress,
      classesCompleted,
      classesCancelledOrRescheduled,
      missingTeachingRecords,
      pendingTopics,
    },
    financialStats: canSeeFinance
      ? {
          todayCollectionPaise,
          monthlyCollectionPaise,
          outstandingFeesPaise,
          pendingSalaryPaise,
          approvedPayrollPaise,
        }
      : null,
    alerts: {
      missingExitsCount,
      pendingLeavesCount,
      studentsWithOverdueFees,
    },
    batchChart,
    recentAudit,
  });
});

// ======================== STUDENT & PARENT PORTALS ========================
function buildStudentPortalPayload(studentId: number) {
  const db = getDb();
  const todayIso = new Date().toISOString().slice(0, 10);

  const profile = db
    .prepare(
      `SELECT s.id, s.student_code as studentCode, s.full_name as fullName, s.email, s.phone,
              s.academic_level as academicLevel, s.admission_date as admissionDate,
              b.name as branchName, s.status
       FROM students s
       JOIN branches b ON b.id = s.branch_id
       WHERE s.id = ?`
    )
    .get(studentId) as Record<string, unknown> | undefined;
  if (!profile) return null;

  const batches = db
    .prepare(
      `SELECT bt.id, bt.code, bt.name, c.id as courseId, c.name as courseName, bt.classroom
       FROM enrolments e
       JOIN batches bt ON bt.id = e.batch_id
       JOIN courses c ON c.id = bt.course_id
       WHERE e.student_id = ? AND e.status = 'ACTIVE'`
    )
    .all(studentId) as Array<{ id: number; courseId: number } & Record<string, unknown>>;

  const batchIds = batches.map((b) => b.id);
  const timetable = batchIds.length
    ? db
        .prepare(
          `SELECT ts.day_of_week as dayOfWeek, ts.start_time as startTime, ts.end_time as endTime,
                  ts.classroom, sub.name as subjectName, t.full_name as teacherName, bt.name as batchName
           FROM timetable_slots ts
           JOIN subjects sub ON sub.id = ts.subject_id
           JOIN teachers t ON t.id = ts.teacher_id
           JOIN batches bt ON bt.id = ts.batch_id
           WHERE ts.batch_id IN (${batchIds.map(() => '?').join(',')})`
        )
        .all(...batchIds)
    : [];

  const attendanceRows = db
    .prepare(
      `SELECT cs.session_date as sessionDate, sub.name as subjectName, sa.status
       FROM student_attendance sa
       JOIN class_sessions cs ON cs.id = sa.class_session_id
       JOIN subjects sub ON sub.id = cs.subject_id
       WHERE sa.student_id = ?
       ORDER BY cs.session_date DESC`
    )
    .all(studentId) as Array<{
    sessionDate: string;
    subjectName: string;
    status: 'PRESENT' | 'ABSENT' | 'LATE' | 'APPROVED_LEAVE';
  }>;

  const attendanceSummary = calculateAttendanceSummary(attendanceRows.map((r) => r.status));

  const movements = db
    .prepare(
      `SELECT movement_date as movementDate, entry_time as entryTime, exit_time as exitTime,
              exception_flag as exceptionFlag, exception_reason as exceptionReason
       FROM student_movements WHERE student_id = ? ORDER BY id DESC LIMIT 15`
    )
    .all(studentId);

  const homework = db
    .prepare(
      `SELECT hw.id, hw.title, hw.chapter_name as chapterName, hw.instructions, hw.due_date as dueDate,
              sub.name as subjectName, hs.status, hs.teacher_feedback as teacherFeedback
       FROM homework_submissions hs
       JOIN homework hw ON hw.id = hs.homework_id
       JOIN subjects sub ON sub.id = hw.subject_id
       WHERE hs.student_id = ?
       ORDER BY hw.due_date DESC`
    )
    .all(studentId);

  const examResults = db
    .prepare(
      `SELECT ex.title as examTitle, ex.exam_date as examDate, ex.max_marks as maxMarks,
              sub.name as subjectName, er.marks_obtained as marksObtained,
              er.percentage, er.grade, er.passed, er.remarks
       FROM exam_results er
       JOIN examinations ex ON ex.id = er.examination_id
       JOIN subjects sub ON sub.id = ex.subject_id
       WHERE er.student_id = ?
       ORDER BY ex.exam_date DESC`
    )
    .all(studentId);

  const rawAssessments = db
    .prepare(
      `SELECT fa.id, fa.title, fa.gross_amount_paise, fa.discount_paise, fa.adjustment_paise, fa.due_date,
              COALESCE((SELECT SUM(pa.allocated_paise) FROM payment_allocations pa WHERE pa.assessment_id = fa.id AND pa.is_reversed = 0), 0) as paid,
              COALESCE((SELECT SUM(fr.amount_paise) FROM fee_refunds fr WHERE fr.assessment_id = fa.id), 0) as refunded
       FROM fee_assessments fa WHERE fa.student_id = ?`
    )
    .all(studentId) as Array<{
    id: number;
    title: string;
    gross_amount_paise: number;
    discount_paise: number;
    adjustment_paise: number;
    due_date: string;
    paid: number;
    refunded: number;
  }>;

  const feeAssessments = rawAssessments.map((a) => ({
    id: a.id,
    title: a.title,
    dueDate: a.due_date,
    ...calculateFeeBalance(
      {
        grossAmountPaise: a.gross_amount_paise,
        discountPaise: a.discount_paise,
        adjustmentPaise: a.adjustment_paise,
        allocatedPaidPaise: a.paid,
        refundedPaise: a.refunded,
      },
      a.due_date,
      todayIso
    ),
  }));

  const receipts = db
    .prepare(
      `SELECT receipt_number as receiptNumber, amount_paise as amountPaise, payment_method as paymentMethod,
              payment_date as paymentDate, status
       FROM payments WHERE student_id = ? ORDER BY id DESC`
    )
    .all(studentId);

  let syllabusProgress = {
    totalTopics: 0,
    completedTopics: 0,
    partialTopics: 0,
    pendingTopics: 0,
    coveragePercentage: 0,
  };
  if (batches.length > 0) {
    const tRows = db
      .prepare(
        `SELECT st.id as topicId, COALESCE(btp.status, 'PENDING') as status
         FROM syllabus_topics st
         JOIN subjects sub ON sub.id = st.subject_id
         LEFT JOIN batch_topic_progress btp ON btp.topic_id = st.id AND btp.batch_id = ?
         WHERE sub.course_id = ?`
      )
      .all(batches[0].id, batches[0].courseId) as Array<{
      topicId: number;
      status: 'PENDING' | 'PARTIAL' | 'COMPLETED';
    }>;
    syllabusProgress = calculateSyllabusProgress(tRows);
  }

  return {
    profile,
    batches,
    timetable,
    attendanceSummary,
    attendanceRows,
    movements,
    homework,
    examResults,
    feeAssessments,
    receipts,
    syllabusProgress,
  };
}

portalsReportsRouter.get('/portal/student', requirePermission(Permission.PORTAL_STUDENT), (req, res) => {
  const sid = req.authUser!.studentId;
  if (!sid) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'No student profile linked to this account.' });
    return;
  }
  const payload = buildStudentPortalPayload(sid);
  res.json(payload);
});

portalsReportsRouter.get('/portal/parent', requirePermission(Permission.PORTAL_PARENT), (req, res) => {
  const gid = req.authUser!.guardianId;
  if (!gid) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'No guardian profile linked to this account.' });
    return;
  }
  const db = getDb();
  // Strictly enforce guardian-child link on server
  const linkedChildren = db
    .prepare(
      `SELECT student_id FROM student_guardians WHERE guardian_id = ?`
    )
    .all(gid) as Array<{ student_id: number }>;

  const requestedChildId = req.query.studentId ? Number(req.query.studentId) : null;
  if (
    requestedChildId &&
    !linkedChildren.some((c) => c.student_id === requestedChildId)
  ) {
    writeAuditLog({
      actor: req.authUser!,
      action: 'UNAUTHORIZED_GUARDIAN_CHILD_LOOKUP',
      entityType: 'students',
      entityId: requestedChildId,
      outcome: 'DENIED',
    });
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Access denied: student is not linked to your guardian profile.',
    });
    return;
  }

  const childrenData = linkedChildren
    .map((c) => buildStudentPortalPayload(c.student_id))
    .filter(Boolean);

  res.json({ children: childrenData });
});

// ======================== NOTIFICATIONS & ANNOUNCEMENTS ========================
portalsReportsRouter.get('/notifications', requireAuth, (req, res) => {
  const u = req.authUser!;
  const db = getDb();
  let sql = `
    SELECT id, branch_id as branchId, target_role as targetRole, event_type as eventType,
           title, message, channel, delivery_mode as deliveryMode,
           delivery_status as deliveryStatus, is_read as isRead, created_at as createdAt
    FROM notifications
    WHERE (target_user_id IS NULL OR target_user_id = ?)
      AND (target_role IS NULL OR target_role = ?)
  `;
  const params: Array<string | number> = [u.id, u.roleCode];
  if (u.roleCode !== RoleCode.SUPER_ADMIN && u.branchId !== null) {
    sql += ' AND (branch_id IS NULL OR branch_id = ?)';
    params.push(u.branchId);
  }
  sql += ' ORDER BY id DESC LIMIT 60';

  const notifications = db.prepare(sql).all(...params);
  res.json({
    notifications,
    providerStatus: {
      IN_APP: true,
      EMAIL: isProviderLive('EMAIL'),
      SMS: isProviderLive('SMS'),
      WHATSAPP: isProviderLive('WHATSAPP'),
    },
  });
});

portalsReportsRouter.post('/notifications', requirePermission(Permission.NOTIFICATION_MANAGE), (req, res) => {
  const schema = z.object({
    branchId: z.number().int().positive().nullable().default(null),
    targetRole: z.string().nullable().default(null),
    eventType: z.string().default('ANNOUNCEMENT'),
    title: z.string().min(3),
    message: z.string().min(5),
    channels: z.array(z.enum(['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP'])).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const d = parsed.data;
  const scope = resolveScopedBranchId(req.authUser!, d.branchId);
  if (!scope.allowed && d.branchId !== null) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch.' });
    return;
  }
  const effectiveBranch =
    req.authUser!.roleCode === RoleCode.SUPER_ADMIN ? d.branchId : req.authUser!.branchId;

  const ids = dispatchNotification({
    branchId: effectiveBranch,
    targetRole: d.targetRole,
    eventType: d.eventType,
    title: d.title.trim(),
    message: d.message.trim(),
    channels: d.channels,
    createdByUserId: req.authUser!.id,
  });

  res.status(201).json({ ids });
});

portalsReportsRouter.patch('/notifications/:id/read', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  getDb().prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ======================== REPORTS & AUDITABLE CSV/EXCEL EXPORTS ========================
portalsReportsRouter.get('/reports/daily-teaching', requirePermission(Permission.REPORT_VIEW, Permission.ACADEMIC_VIEW), (req, res) => {
  const scope = resolveScopedBranchId(req.authUser!, req.query.branchId as string | undefined);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch.' });
    return;
  }
  const dateStr = String(req.query.date || new Date().toISOString().slice(0, 10)).trim();
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT cs.session_code as sessionCode, cs.session_date as sessionDate, b.name as branchName,
              bt.name as batchName, sub.name as subjectName,
              COALESCE(tCond.full_name, tSub.full_name, tAss.full_name) as teacherName,
              cs.scheduled_start as scheduledStart, cs.scheduled_end as scheduledEnd,
              cs.status as sessionStatus,
              tr.chapter_covered as chapterCovered, tr.topics_summary as topicsSummary,
              tr.homework_assigned as homeworkAssigned, tr.next_lesson_plan as nextLessonPlan
       FROM class_sessions cs
       JOIN branches b ON b.id = cs.branch_id
       JOIN batches bt ON bt.id = cs.batch_id
       JOIN subjects sub ON sub.id = cs.subject_id
       JOIN teachers tAss ON tAss.id = cs.assigned_teacher_id
       LEFT JOIN teachers tSub ON tSub.id = cs.substitute_teacher_id
       LEFT JOIN teachers tCond ON tCond.id = cs.conducted_by_teacher_id
       LEFT JOIN teaching_records tr ON tr.class_session_id = cs.id
       WHERE cs.session_date = ? ${scope.branchId !== null ? 'AND cs.branch_id = ?' : ''}
       ORDER BY cs.scheduled_start ASC`
    )
    .all(dateStr, ...(scope.branchId !== null ? [scope.branchId] : []));

  res.json({ date: dateStr, rows });
});

function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const escapeCell = (val: string | number | null | undefined) => {
    const s = val === null || val === undefined ? '' : String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\n');
}

portalsReportsRouter.get('/reports/export/:reportType', requirePermission(Permission.REPORT_EXPORT), (req, res) => {
  const reportType = req.params.reportType;
  const format = String(req.query.format || 'csv').toLowerCase();
  const scope = resolveScopedBranchId(req.authUser!, req.query.branchId as string | undefined);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch export.' });
    return;
  }

  const db = getDb();
  const bId = scope.branchId;
  let headers: string[] = [];
  let dataRows: Array<Array<string | number>> = [];

  if (reportType === 'fee-collections') {
    if (!req.authUser!.permissions.includes(Permission.FEE_VIEW)) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Fee viewing permission required.' });
      return;
    }
    headers = ['Receipt Number', 'Date', 'Student ID', 'Student Name', 'Branch', 'Method', 'Amount (INR)', 'Status'];
    const rows = db
      .prepare(
        `SELECT p.receipt_number, p.payment_date, s.student_code, s.full_name, b.name as branch_name,
                p.payment_method, p.amount_paise, p.status
         FROM payments p
         JOIN students s ON s.id = p.student_id
         JOIN branches b ON b.id = p.branch_id
         ${bId ? 'WHERE p.branch_id = ?' : ''}
         ORDER BY p.payment_date DESC`
      )
      .all(...(bId ? [bId] : [])) as Array<Record<string, unknown>>;
    dataRows = rows.map((r) => [
      String(r.receipt_number),
      String(r.payment_date),
      String(r.student_code),
      String(r.full_name),
      String(r.branch_name),
      String(r.payment_method),
      paiseToInrString(Number(r.amount_paise)),
      String(r.status),
    ]);
  } else if (reportType === 'student-attendance') {
    headers = ['Session Date', 'Session Code', 'Batch', 'Subject', 'Student ID', 'Student Name', 'Status', 'Correction Note'];
    const rows = db
      .prepare(
        `SELECT cs.session_date, cs.session_code, bt.name as batch_name, sub.name as subject_name,
                s.student_code, s.full_name, sa.status, sa.correction_reason
         FROM student_attendance sa
         JOIN class_sessions cs ON cs.id = sa.class_session_id
         JOIN batches bt ON bt.id = cs.batch_id
         JOIN subjects sub ON sub.id = cs.subject_id
         JOIN students s ON s.id = sa.student_id
         ${bId ? 'WHERE cs.branch_id = ?' : ''}
         ORDER BY cs.session_date DESC`
      )
      .all(...(bId ? [bId] : [])) as Array<Record<string, unknown>>;
    dataRows = rows.map((r) => [
      String(r.session_date),
      String(r.session_code),
      String(r.batch_name),
      String(r.subject_name),
      String(r.student_code),
      String(r.full_name),
      String(r.status),
      String(r.correction_reason || ''),
    ]);
  } else if (reportType === 'payroll-summary') {
    if (
      !req.authUser!.permissions.includes(Permission.PAYROLL_CALCULATE) &&
      !req.authUser!.permissions.includes(Permission.PAYROLL_APPROVE)
    ) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Payroll authorization required.' });
      return;
    }
    headers = ['Period', 'Branch', 'Employee Code', 'Faculty Name', 'Model', 'Gross (INR)', 'Deductions (INR)', 'Net Payable (INR)', 'Payment Status'];
    const rows = db
      .prepare(
        `SELECT pr.period_month, b.name as branch_name, t.employee_code, t.full_name, pi.salary_model,
                pi.gross_paise, pi.total_deductions_paise, pi.net_payable_paise, pi.payment_status
         FROM payroll_items pi
         JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
         JOIN branches b ON b.id = pr.branch_id
         JOIN teachers t ON t.id = pi.teacher_id
         ${bId ? 'WHERE pr.branch_id = ?' : ''}
         ORDER BY pr.period_month DESC`
      )
      .all(...(bId ? [bId] : [])) as Array<Record<string, unknown>>;
    dataRows = rows.map((r) => [
      String(r.period_month),
      String(r.branch_name),
      String(r.employee_code),
      String(r.full_name),
      String(r.salary_model),
      paiseToInrString(Number(r.gross_paise)),
      paiseToInrString(Number(r.total_deductions_paise)),
      paiseToInrString(Number(r.net_payable_paise)),
      String(r.payment_status),
    ]);
  } else {
    res.status(400).json({ error: 'UNKNOWN_REPORT', message: 'Unsupported report type.' });
    return;
  }

  // Record sensitive export in audit log
  writeAuditLog({
    actor: req.authUser!,
    branchId: bId,
    action: `SENSITIVE_EXPORT:${reportType.toUpperCase()}`,
    entityType: 'reports',
    entityId: `${reportType}:${format}`,
    after: { rowCount: dataRows.length },
  });

  if (format === 'json') {
    res.json({ headers, rows: dataRows });
    return;
  }

  // UTF-8 BOM makes CSV open cleanly with ₹ and columns in Microsoft Excel
  const csvBody = '\uFEFF' + toCsv(headers, dataRows);
  const ext = format === 'excel' ? 'xls.csv' : 'csv';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="ims-${reportType}-${new Date().toISOString().slice(0, 10)}.${ext}"`
  );
  res.send(csvBody);
});
