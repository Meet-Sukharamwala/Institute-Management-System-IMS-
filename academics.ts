import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { requirePermission, resolveScopedBranchId } from '../auth';
import { Permission, RoleCode } from '../../shared/types';
import {
  inrToPaise,
  calculateSyllabusProgress,
  hasScheduleConflict,
  evaluateExamResult,
} from '../../shared/domain-logic';
import { writeAuditLog } from '../audit';
import { dispatchNotification } from '../notifications';

export const academicsRouter = Router();

// ======================== COURSES, SUBJECTS, BATCHES, SYLLABUS ========================
academicsRouter.get('/academics/overview', requirePermission(Permission.ACADEMIC_VIEW, Permission.EXAM_VIEW, Permission.HOMEWORK_VIEW), (req, res) => {
  const scope = resolveScopedBranchId(req.authUser!, req.query.branchId as string | undefined);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch filter.' });
    return;
  }
  const db = getDb();
  const branchClause = scope.branchId !== null ? 'WHERE c.branch_id = ?' : '';
  const branchParams = scope.branchId !== null ? [scope.branchId] : [];

  const courses = db
    .prepare(
      `SELECT c.id, c.code, c.name, c.academic_level as academicLevel,
              c.duration_months as durationMonths, c.start_date as startDate, c.end_date as endDate,
              c.default_fee_paise as defaultFeePaise, c.branch_id as branchId, b.name as branchName, c.status
       FROM courses c
       JOIN branches b ON b.id = c.branch_id
       ${branchClause}
       ORDER BY c.id DESC`
    )
    .all(...branchParams) as Array<Record<string, unknown>>;

  const enrichedCourses = courses.map((c) => {
    const cid = Number(c.id);
    const subjects = db
      .prepare('SELECT id, code, name, sort_order as sortOrder FROM subjects WHERE course_id = ? ORDER BY sort_order ASC')
      .all(cid) as Array<Record<string, unknown>>;
    const subjectsWithTopics = subjects.map((s) => {
      const topics = db
        .prepare(
          `SELECT id, chapter_name as chapterName, topic_title as topicTitle, sort_order as sortOrder, planned_date as plannedDate
           FROM syllabus_topics WHERE subject_id = ? ORDER BY sort_order ASC`
        )
        .all(Number(s.id));
      return { ...s, topics };
    });
    return { ...c, subjects: subjectsWithTopics };
  });

  const batchClause = scope.branchId !== null ? 'WHERE bt.branch_id = ?' : '';
  const batches = db
    .prepare(
      `SELECT bt.id, bt.code, bt.name, bt.course_id as courseId, c.name as courseName,
              bt.branch_id as branchId, b.name as branchName, bt.classroom,
              bt.max_capacity as maxCapacity, bt.start_date as startDate, bt.end_date as endDate, bt.status,
              (SELECT COUNT(*) FROM enrolments e WHERE e.batch_id = bt.id AND e.status = 'ACTIVE') as enrolledCount
       FROM batches bt
       JOIN courses c ON c.id = bt.course_id
       JOIN branches b ON b.id = bt.branch_id
       ${batchClause}
       ORDER BY bt.id DESC`
    )
    .all(...branchParams) as Array<Record<string, unknown>>;

  const enrichedBatches = batches.map((bt) => {
    const bid = Number(bt.id);
    const courseId = Number(bt.courseId);
    const allTopics = db
      .prepare(
        `SELECT st.id as topicId, st.chapter_name as chapterName, st.topic_title as topicTitle,
                sub.name as subjectName, st.planned_date as plannedDate,
                COALESCE(btp.status, 'PENDING') as status, btp.completed_on as completedOn
         FROM syllabus_topics st
         JOIN subjects sub ON sub.id = st.subject_id
         LEFT JOIN batch_topic_progress btp ON btp.topic_id = st.id AND btp.batch_id = ?
         WHERE sub.course_id = ?
         ORDER BY sub.sort_order ASC, st.sort_order ASC`
      )
      .all(bid, courseId) as Array<{
      topicId: number;
      chapterName: string;
      topicTitle: string;
      subjectName: string;
      plannedDate: string | null;
      status: 'PENDING' | 'PARTIAL' | 'COMPLETED';
      completedOn: string | null;
    }>;

    const progress = calculateSyllabusProgress(
      allTopics.map((t) => ({ topicId: t.topicId, status: t.status }))
    );

    const teachers = db
      .prepare(
        `SELECT t.id as teacherId, t.full_name as teacherName, sub.id as subjectId, sub.name as subjectName
         FROM batch_teachers btr
         JOIN teachers t ON t.id = btr.teacher_id
         JOIN subjects sub ON sub.id = btr.subject_id
         WHERE btr.batch_id = ?`
      )
      .all(bid);

    return {
      ...bt,
      teachers,
      syllabusProgress: progress,
      syllabusTopics: allTopics,
    };
  });

  const timetableClause = scope.branchId !== null ? 'WHERE ts.branch_id = ?' : '';
  const timetableSlots = db
    .prepare(
      `SELECT ts.id, ts.branch_id as branchId, ts.batch_id as batchId, bt.name as batchName,
              ts.subject_id as subjectId, sub.name as subjectName,
              ts.teacher_id as teacherId, t.full_name as teacherName,
              ts.day_of_week as dayOfWeek, ts.start_time as startTime, ts.end_time as endTime, ts.classroom
       FROM timetable_slots ts
       JOIN batches bt ON bt.id = ts.batch_id
       JOIN subjects sub ON sub.id = ts.subject_id
       JOIN teachers t ON t.id = ts.teacher_id
       ${timetableClause}
       ORDER BY ts.day_of_week ASC, ts.start_time ASC`
    )
    .all(...branchParams);

  res.json({ courses: enrichedCourses, batches: enrichedBatches, timetableSlots });
});

academicsRouter.post('/courses', requirePermission(Permission.ACADEMIC_MANAGE), (req, res) => {
  const schema = z.object({
    code: z.string().min(3),
    name: z.string().min(3),
    academicLevel: z.string().min(2),
    durationMonths: z.number().int().min(1).max(48),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    defaultFeeInr: z.number().nonnegative(),
    branchId: z.number().int().positive(),
    initialSubjects: z
      .array(
        z.object({
          code: z.string().min(2),
          name: z.string().min(2),
          topics: z.array(z.object({ chapterName: z.string(), topicTitle: z.string() })).default([]),
        })
      )
      .default([]),
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
  try {
    const courseId = db.transaction(() => {
      const cRes = db
        .prepare(
          `INSERT INTO courses (code, name, academic_level, duration_months, start_date, end_date, default_fee_paise, branch_id, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`
        )
        .run(
          d.code.trim().toUpperCase(),
          d.name.trim(),
          d.academicLevel.trim(),
          d.durationMonths,
          d.startDate,
          d.endDate,
          inrToPaise(d.defaultFeeInr),
          scope.branchId,
          new Date().toISOString()
        );
      const cid = Number(cRes.lastInsertRowid);
      d.initialSubjects.forEach((sub, idx) => {
        const sRes = db
          .prepare('INSERT INTO subjects (course_id, code, name, sort_order) VALUES (?, ?, ?, ?)')
          .run(cid, sub.code.trim().toUpperCase(), sub.name.trim(), idx + 1);
        const sid = Number(sRes.lastInsertRowid);
        sub.topics.forEach((tp, tIdx) => {
          db.prepare(
            'INSERT INTO syllabus_topics (subject_id, chapter_name, topic_title, sort_order) VALUES (?, ?, ?, ?)'
          ).run(sid, tp.chapterName.trim(), tp.topicTitle.trim(), tIdx + 1);
        });
      });
      return cid;
    })();

    writeAuditLog({
      actor: req.authUser!,
      branchId: scope.branchId,
      action: 'COURSE_CREATED',
      entityType: 'courses',
      entityId: courseId,
      after: { code: d.code, name: d.name },
    });
    res.status(201).json({ id: courseId });
  } catch {
    res.status(409).json({ error: 'CONFLICT', message: 'Course code already exists.' });
  }
});

academicsRouter.post('/subjects/:subjectId/topics', requirePermission(Permission.ACADEMIC_MANAGE), (req, res) => {
  const subjectId = Number(req.params.subjectId);
  const schema = z.object({
    chapterName: z.string().min(2),
    topicTitle: z.string().min(2),
    plannedDate: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  const nextOrder = (
    db
      .prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 as n FROM syllabus_topics WHERE subject_id = ?')
      .get(subjectId) as { n: number }
  ).n;
  const info = db
    .prepare(
      'INSERT INTO syllabus_topics (subject_id, chapter_name, topic_title, sort_order, planned_date) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      subjectId,
      parsed.data.chapterName.trim(),
      parsed.data.topicTitle.trim(),
      nextOrder,
      parsed.data.plannedDate || null
    );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

academicsRouter.post('/batches', requirePermission(Permission.ACADEMIC_MANAGE), (req, res) => {
  const schema = z.object({
    code: z.string().min(3),
    name: z.string().min(3),
    courseId: z.number().int().positive(),
    branchId: z.number().int().positive(),
    classroom: z.string().default(''),
    maxCapacity: z.number().int().min(1).max(500).default(40),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    teacherId: z.number().int().positive().optional(),
    subjectId: z.number().int().positive().optional(),
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
  try {
    const batchId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO batches (code, name, course_id, branch_id, classroom, max_capacity, start_date, end_date, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`
        )
        .run(
          d.code.trim().toUpperCase(),
          d.name.trim(),
          d.courseId,
          scope.branchId,
          d.classroom.trim(),
          d.maxCapacity,
          d.startDate,
          d.endDate,
          new Date().toISOString()
        );
      const bid = Number(info.lastInsertRowid);
      if (d.teacherId && d.subjectId) {
        db.prepare('INSERT OR IGNORE INTO batch_teachers (batch_id, teacher_id, subject_id) VALUES (?, ?, ?)').run(
          bid,
          d.teacherId,
          d.subjectId
        );
      }
      return bid;
    })();
    writeAuditLog({
      actor: req.authUser!,
      branchId: scope.branchId,
      action: 'BATCH_CREATED',
      entityType: 'batches',
      entityId: batchId,
      after: d,
    });
    res.status(201).json({ id: batchId });
  } catch {
    res.status(409).json({ error: 'CONFLICT', message: 'Batch code already exists.' });
  }
});

// ======================== CLASS SESSIONS & DAILY TEACHING RECORDS ========================
academicsRouter.get('/class-sessions', requirePermission(Permission.ACADEMIC_VIEW, Permission.TEACHING_RECORD_SUBMIT), (req, res) => {
  const scope = resolveScopedBranchId(req.authUser!, req.query.branchId as string | undefined);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch filter.' });
    return;
  }
  const dateFilter = String(req.query.date || '').trim();
  const batchId = req.query.batchId ? Number(req.query.batchId) : null;
  const db = getDb();

  let where = 'WHERE 1=1';
  const params: Array<string | number> = [];
  if (scope.branchId !== null) {
    where += ' AND cs.branch_id = ?';
    params.push(scope.branchId);
  }
  if (dateFilter) {
    where += ' AND cs.session_date = ?';
    params.push(dateFilter);
  }
  if (batchId) {
    where += ' AND cs.batch_id = ?';
    params.push(batchId);
  }
  if (req.authUser!.roleCode === RoleCode.TEACHER && req.authUser!.teacherId) {
    where += ' AND (cs.assigned_teacher_id = ? OR cs.substitute_teacher_id = ?)';
    params.push(req.authUser!.teacherId, req.authUser!.teacherId);
  }

  const sessions = db
    .prepare(
      `SELECT cs.id, cs.session_code as sessionCode, cs.branch_id as branchId, b.name as branchName,
              cs.course_id as courseId, c.name as courseName,
              cs.batch_id as batchId, bt.name as batchName,
              cs.subject_id as subjectId, sub.name as subjectName,
              cs.assigned_teacher_id as assignedTeacherId, t1.full_name as assignedTeacherName,
              cs.substitute_teacher_id as substituteTeacherId, t2.full_name as substituteTeacherName,
              cs.conducted_by_teacher_id as conductedByTeacherId, t3.full_name as conductedByTeacherName,
              cs.session_date as sessionDate, cs.scheduled_start as scheduledStart, cs.scheduled_end as scheduledEnd,
              cs.classroom, cs.status, cs.cancellation_reason as cancellationReason,
              tr.id as teachingRecordId, tr.actual_start as actualStart, tr.actual_end as actualEnd,
              tr.chapter_covered as chapterCovered, tr.topics_summary as topicsSummary,
              tr.coverage_status as coverageStatus, tr.homework_assigned as homeworkAssigned,
              tr.next_lesson_plan as nextLessonPlan, tr.student_observations as studentObservations,
              tr.remarks, tr.reviewed_at as reviewedAt
       FROM class_sessions cs
       JOIN branches b ON b.id = cs.branch_id
       JOIN courses c ON c.id = cs.course_id
       JOIN batches bt ON bt.id = cs.batch_id
       JOIN subjects sub ON sub.id = cs.subject_id
       JOIN teachers t1 ON t1.id = cs.assigned_teacher_id
       LEFT JOIN teachers t2 ON t2.id = cs.substitute_teacher_id
       LEFT JOIN teachers t3 ON t3.id = cs.conducted_by_teacher_id
       LEFT JOIN teaching_records tr ON tr.class_session_id = cs.id
       ${where}
       ORDER BY cs.session_date DESC, cs.scheduled_start ASC`
    )
    .all(...params);

  res.json({ sessions });
});

academicsRouter.post('/class-sessions', requirePermission(Permission.ACADEMIC_MANAGE), (req, res) => {
  const schema = z.object({
    branchId: z.number().int().positive(),
    batchId: z.number().int().positive(),
    subjectId: z.number().int().positive(),
    assignedTeacherId: z.number().int().positive(),
    sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    scheduledStart: z.string().regex(/^\d{2}:\d{2}$/),
    scheduledEnd: z.string().regex(/^\d{2}:\d{2}$/),
    classroom: z.string().default(''),
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
  const batchRow = db
    .prepare('SELECT id, course_id, branch_id FROM batches WHERE id = ?')
    .get(d.batchId) as { id: number; course_id: number; branch_id: number } | undefined;
  if (!batchRow || batchRow.branch_id !== scope.branchId) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Batch does not belong to selected branch.' });
    return;
  }

  const existingDaySessions = db
    .prepare(
      `SELECT scheduled_start as startTime, scheduled_end as endTime,
              COALESCE(substitute_teacher_id, assigned_teacher_id) as teacherId, classroom
       FROM class_sessions
       WHERE session_date = ? AND branch_id = ? AND status NOT IN ('CANCELLED', 'RESCHEDULED')`
    )
    .all(d.sessionDate, scope.branchId) as Array<{
    startTime: string;
    endTime: string;
    teacherId: number;
    classroom: string | null;
  }>;

  const conflictCheck = hasScheduleConflict(existingDaySessions, {
    startTime: d.scheduledStart,
    endTime: d.scheduledEnd,
    teacherId: d.assignedTeacherId,
    classroom: d.classroom || null,
  });
  if (conflictCheck.conflict) {
    res.status(409).json({ error: 'SCHEDULE_CONFLICT', message: conflictCheck.reason });
    return;
  }

  const seq = (db.prepare('SELECT COALESCE(MAX(id), 100) + 1 as n FROM class_sessions').get() as { n: number }).n;
  const sessionCode = `SES-${d.sessionDate.slice(0, 4)}-${seq}`;
  const info = db
    .prepare(
      `INSERT INTO class_sessions (session_code, branch_id, course_id, batch_id, subject_id, assigned_teacher_id, session_date, scheduled_start, scheduled_end, classroom, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?)`
    )
    .run(
      sessionCode,
      scope.branchId,
      batchRow.course_id,
      d.batchId,
      d.subjectId,
      d.assignedTeacherId,
      d.sessionDate,
      d.scheduledStart,
      d.scheduledEnd,
      d.classroom.trim(),
      new Date().toISOString()
    );

  writeAuditLog({
    actor: req.authUser!,
    branchId: scope.branchId,
    action: 'CLASS_SESSION_SCHEDULED',
    entityType: 'class_sessions',
    entityId: sessionCode,
    after: d,
  });

  res.status(201).json({ id: Number(info.lastInsertRowid), sessionCode });
});

academicsRouter.patch('/class-sessions/:id/substitute-or-status', requirePermission(Permission.ACADEMIC_MANAGE), (req, res) => {
  const sessionId = Number(req.params.id);
  const schema = z.object({
    status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'CANCELLED', 'RESCHEDULED', 'NOT_CONDUCTED']),
    substituteTeacherId: z.number().int().positive().nullable().optional(),
    reason: z.string().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  const ses = db
    .prepare('SELECT id, session_code, branch_id, assigned_teacher_id, substitute_teacher_id, status FROM class_sessions WHERE id = ?')
    .get(sessionId) as
    | {
        id: number;
        session_code: string;
        branch_id: number;
        assigned_teacher_id: number;
        substitute_teacher_id: number | null;
        status: string;
      }
    | undefined;
  if (!ses) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Class session not found.' });
    return;
  }
  const scope = resolveScopedBranchId(req.authUser!, ses.branch_id);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Branch restriction.' });
    return;
  }

  db.prepare(
    'UPDATE class_sessions SET status = ?, substitute_teacher_id = ?, cancellation_reason = ? WHERE id = ?'
  ).run(
    parsed.data.status,
    parsed.data.substituteTeacherId !== undefined ? parsed.data.substituteTeacherId : ses.substitute_teacher_id,
    parsed.data.reason.trim(),
    sessionId
  );

  writeAuditLog({
    actor: req.authUser!,
    branchId: ses.branch_id,
    action: 'CLASS_SESSION_MODIFIED_OR_SUBSTITUTED',
    entityType: 'class_sessions',
    entityId: ses.session_code,
    before: { status: ses.status, substituteTeacherId: ses.substitute_teacher_id },
    after: parsed.data,
  });

  if (parsed.data.status === 'CANCELLED' || parsed.data.substituteTeacherId) {
    dispatchNotification({
      branchId: ses.branch_id,
      eventType: parsed.data.status === 'CANCELLED' ? 'CLASS_CANCELLED' : 'TIMETABLE_CHANGE',
      title: `Session ${ses.session_code} Updated (${parsed.data.status})`,
      message: parsed.data.reason || 'Operational schedule updated by administration.',
      channels: ['IN_APP'],
      createdByUserId: req.authUser!.id,
    });
  }

  res.json({ ok: true });
});

academicsRouter.post('/teaching-records', requirePermission(Permission.TEACHING_RECORD_SUBMIT), (req, res) => {
  const schema = z.object({
    classSessionId: z.number().int().positive(),
    conductedByTeacherId: z.number().int().positive().optional(),
    actualStart: z.string().regex(/^\d{2}:\d{2}$/),
    actualEnd: z.string().regex(/^\d{2}:\d{2}$/),
    chapterCovered: z.string().min(2),
    topicsSummary: z.string().min(5),
    coverageStatus: z.enum(['COMPLETED', 'PARTIALLY_COMPLETED']),
    topicUpdates: z
      .array(
        z.object({
          topicId: z.number().int().positive(),
          status: z.enum(['PARTIAL', 'COMPLETED']),
        })
      )
      .default([]),
    homeworkAssigned: z.string().default(''),
    nextLessonPlan: z.string().default(''),
    studentObservations: z.string().default(''),
    remarks: z.string().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const d = parsed.data;
  const db = getDb();
  const ses = db
    .prepare(
      `SELECT id, session_code, branch_id, batch_id, session_date, assigned_teacher_id, substitute_teacher_id, status
       FROM class_sessions WHERE id = ?`
    )
    .get(d.classSessionId) as
    | {
        id: number;
        session_code: string;
        branch_id: number;
        batch_id: number;
        session_date: string;
        assigned_teacher_id: number;
        substitute_teacher_id: number | null;
        status: string;
      }
    | undefined;

  if (!ses) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Scheduled session not found.' });
    return;
  }

  const u = req.authUser!;
  if (u.roleCode === RoleCode.TEACHER) {
    if (
      !u.teacherId ||
      (u.teacherId !== ses.assigned_teacher_id && u.teacherId !== ses.substitute_teacher_id)
    ) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Only the assigned or authorized substitute teacher can submit this teaching record.',
      });
      return;
    }
  } else {
    const scope = resolveScopedBranchId(u, ses.branch_id);
    if (!scope.allowed) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Branch restriction.' });
      return;
    }
  }

  const effectiveTeacherId =
    u.teacherId || d.conductedByTeacherId || ses.substitute_teacher_id || ses.assigned_teacher_id;
  const nowIso = new Date().toISOString();

  const existingRecord = db
    .prepare('SELECT * FROM teaching_records WHERE class_session_id = ?')
    .get(d.classSessionId) as Record<string, unknown> | undefined;

  const recordId = db.transaction(() => {
    let trId: number;
    if (existingRecord) {
      db.prepare(
        `UPDATE teaching_records
         SET submitted_by_teacher_id = ?, actual_start = ?, actual_end = ?, chapter_covered = ?,
             topics_summary = ?, coverage_status = ?, homework_assigned = ?, next_lesson_plan = ?,
             student_observations = ?, remarks = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        effectiveTeacherId,
        d.actualStart,
        d.actualEnd,
        d.chapterCovered.trim(),
        d.topicsSummary.trim(),
        d.coverageStatus,
        d.homeworkAssigned.trim(),
        d.nextLessonPlan.trim(),
        d.studentObservations.trim(),
        d.remarks.trim(),
        nowIso,
        Number(existingRecord.id)
      );
      trId = Number(existingRecord.id);
    } else {
      const ins = db
        .prepare(
          `INSERT INTO teaching_records (
            class_session_id, submitted_by_teacher_id, actual_start, actual_end,
            chapter_covered, topics_summary, coverage_status, homework_assigned,
            next_lesson_plan, student_observations, remarks, updated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          d.classSessionId,
          effectiveTeacherId,
          d.actualStart,
          d.actualEnd,
          d.chapterCovered.trim(),
          d.topicsSummary.trim(),
          d.coverageStatus,
          d.homeworkAssigned.trim(),
          d.nextLessonPlan.trim(),
          d.studentObservations.trim(),
          d.remarks.trim(),
          nowIso,
          nowIso
        );
      trId = Number(ins.lastInsertRowid);
    }

    db.prepare(
      'UPDATE class_sessions SET status = ?, conducted_by_teacher_id = ? WHERE id = ?'
    ).run(d.coverageStatus, effectiveTeacherId, d.classSessionId);

    const upsertTopic = db.prepare(
      `INSERT INTO batch_topic_progress (batch_id, topic_id, status, completed_on, teaching_record_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(batch_id, topic_id) DO UPDATE SET
         status = CASE WHEN excluded.status = 'COMPLETED' THEN 'COMPLETED' ELSE batch_topic_progress.status END,
         completed_on = excluded.completed_on,
         teaching_record_id = excluded.teaching_record_id`
    );

    for (const tu of d.topicUpdates) {
      upsertTopic.run(ses.batch_id, tu.topicId, tu.status, ses.session_date, trId);
    }

    return trId;
  })();

  writeAuditLog({
    actor: u,
    branchId: ses.branch_id,
    action: existingRecord ? 'TEACHING_RECORD_CORRECTED' : 'TEACHING_RECORD_SUBMITTED',
    entityType: 'teaching_records',
    entityId: recordId,
    before: existingRecord ?? null,
    after: d,
  });

  res.status(existingRecord ? 200 : 201).json({ id: recordId });
});

// ======================== EXAMINATIONS & HOMEWORK ========================
academicsRouter.get('/examinations', requirePermission(Permission.EXAM_VIEW), (req, res) => {
  const scope = resolveScopedBranchId(req.authUser!, req.query.branchId as string | undefined);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch.' });
    return;
  }
  const db = getDb();
  const clause = scope.branchId !== null ? 'WHERE ex.branch_id = ?' : '';
  const params = scope.branchId !== null ? [scope.branchId] : [];

  const exams = db
    .prepare(
      `SELECT ex.id, ex.exam_code as examCode, ex.title, ex.branch_id as branchId, b.name as branchName,
              ex.batch_id as batchId, bt.name as batchName, ex.subject_id as subjectId, sub.name as subjectName,
              ex.exam_date as examDate, ex.max_marks as maxMarks, ex.passing_marks as passingMarks, ex.status
       FROM examinations ex
       JOIN branches b ON b.id = ex.branch_id
       JOIN batches bt ON bt.id = ex.batch_id
       JOIN subjects sub ON sub.id = ex.subject_id
       ${clause}
       ORDER BY ex.exam_date DESC`
    )
    .all(...params) as Array<Record<string, unknown>>;

  const enriched = exams.map((ex) => {
    const eid = Number(ex.id);
    const results = db
      .prepare(
        `SELECT er.id, er.student_id as studentId, s.student_code as studentCode, s.full_name as studentName,
                er.marks_obtained as marksObtained, er.percentage, er.grade, er.passed, er.remarks, er.is_retake as isRetake
         FROM exam_results er
         JOIN students s ON s.id = er.student_id
         WHERE er.examination_id = ?
         ORDER BY er.marks_obtained DESC`
      )
      .all(eid);
    return { ...ex, results };
  });

  res.json({ examinations: enriched });
});

academicsRouter.post('/examinations', requirePermission(Permission.EXAM_MANAGE), (req, res) => {
  const schema = z.object({
    title: z.string().min(3),
    branchId: z.number().int().positive(),
    batchId: z.number().int().positive(),
    subjectId: z.number().int().positive(),
    examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    maxMarks: z.number().positive(),
    passingMarks: z.number().nonnegative(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const d = parsed.data;
  if (d.passingMarks > d.maxMarks) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Passing marks cannot exceed maximum marks.' });
    return;
  }
  const scope = resolveScopedBranchId(req.authUser!, d.branchId);
  if (!scope.allowed || !scope.branchId) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch.' });
    return;
  }
  const db = getDb();
  const seq = (db.prepare('SELECT COALESCE(MAX(id), 10) + 1 as n FROM examinations').get() as { n: number }).n;
  const examCode = `EXM-${d.examDate.slice(0, 4)}-${seq}`;
  const info = db
    .prepare(
      `INSERT INTO examinations (exam_code, title, branch_id, batch_id, subject_id, exam_date, max_marks, passing_marks, status, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED', ?, ?)`
    )
    .run(
      examCode,
      d.title.trim(),
      scope.branchId,
      d.batchId,
      d.subjectId,
      d.examDate,
      d.maxMarks,
      d.passingMarks,
      req.authUser!.id,
      new Date().toISOString()
    );

  writeAuditLog({
    actor: req.authUser!,
    branchId: scope.branchId,
    action: 'EXAMINATION_CREATED',
    entityType: 'examinations',
    entityId: examCode,
    after: d,
  });

  res.status(201).json({ id: Number(info.lastInsertRowid), examCode });
});

academicsRouter.post('/examinations/:id/results', requirePermission(Permission.EXAM_MANAGE), (req, res) => {
  const examId = Number(req.params.id);
  const schema = z.object({
    studentId: z.number().int().positive(),
    marksObtained: z.number().nonnegative(),
    remarks: z.string().default(''),
    allowCorrectionOrRetake: z.boolean().default(false),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  const exam = db
    .prepare('SELECT id, exam_code, branch_id, max_marks, passing_marks FROM examinations WHERE id = ?')
    .get(examId) as
    | { id: number; exam_code: string; branch_id: number; max_marks: number; passing_marks: number }
    | undefined;
  if (!exam) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Examination not found.' });
    return;
  }
  const scope = resolveScopedBranchId(req.authUser!, exam.branch_id);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Branch restriction.' });
    return;
  }

  let evalOut: ReturnType<typeof evaluateExamResult>;
  try {
    evalOut = evaluateExamResult(parsed.data.marksObtained, exam.max_marks, exam.passing_marks);
  } catch (err: unknown) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: err instanceof Error ? err.message : 'Invalid marks.',
    });
    return;
  }

  const existing = db
    .prepare('SELECT * FROM exam_results WHERE examination_id = ? AND student_id = ?')
    .get(examId, parsed.data.studentId) as Record<string, unknown> | undefined;

  if (existing && !parsed.data.allowCorrectionOrRetake) {
    res.status(409).json({
      error: 'DUPLICATE_RESULT',
      message: 'Result already exists for this student. Enable authorized retake/correction to update.',
    });
    return;
  }

  const nowIso = new Date().toISOString();
  if (existing) {
    db.prepare(
      `UPDATE exam_results
       SET marks_obtained = ?, percentage = ?, grade = ?, passed = ?, remarks = ?, is_retake = 1, recorded_by_user_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      parsed.data.marksObtained,
      evalOut.percentage,
      evalOut.grade,
      evalOut.passed ? 1 : 0,
      parsed.data.remarks.trim(),
      req.authUser!.id,
      nowIso,
      Number(existing.id)
    );
  } else {
    db.prepare(
      `INSERT INTO exam_results (examination_id, student_id, marks_obtained, percentage, grade, passed, remarks, is_retake, recorded_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      examId,
      parsed.data.studentId,
      parsed.data.marksObtained,
      evalOut.percentage,
      evalOut.grade,
      evalOut.passed ? 1 : 0,
      parsed.data.remarks.trim(),
      req.authUser!.id,
      nowIso
    );
  }

  writeAuditLog({
    actor: req.authUser!,
    branchId: exam.branch_id,
    action: existing ? 'EXAM_RESULT_CORRECTED' : 'EXAM_RESULT_RECORDED',
    entityType: 'exam_results',
    entityId: `${exam.exam_code}:stu-${parsed.data.studentId}`,
    before: existing ?? null,
    after: { ...parsed.data, ...evalOut },
  });

  res.status(existing ? 200 : 201).json({ ok: true, evaluation: evalOut });
});

academicsRouter.get('/homework', requirePermission(Permission.HOMEWORK_VIEW), (req, res) => {
  const scope = resolveScopedBranchId(req.authUser!, req.query.branchId as string | undefined);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch.' });
    return;
  }
  const db = getDb();
  const clause = scope.branchId !== null ? 'WHERE hw.branch_id = ?' : '';
  const params = scope.branchId !== null ? [scope.branchId] : [];
  const todayIso = new Date().toISOString().slice(0, 10);

  const list = db
    .prepare(
      `SELECT hw.id, hw.branch_id as branchId, hw.batch_id as batchId, bt.name as batchName,
              hw.subject_id as subjectId, sub.name as subjectName,
              hw.assigned_by_teacher_id as teacherId, t.full_name as teacherName,
              hw.chapter_name as chapterName, hw.title, hw.instructions, hw.due_date as dueDate, hw.created_at as createdAt
       FROM homework hw
       JOIN batches bt ON bt.id = hw.batch_id
       JOIN subjects sub ON sub.id = hw.subject_id
       JOIN teachers t ON t.id = hw.assigned_by_teacher_id
       ${clause}
       ORDER BY hw.due_date DESC, hw.id DESC`
    )
    .all(...params) as Array<Record<string, unknown>>;

  const enriched = list.map((hw) => {
    const hid = Number(hw.id);
    const due = String(hw.dueDate);
    const submissions = db
      .prepare(
        `SELECT hs.id, hs.student_id as studentId, s.student_code as studentCode, s.full_name as studentName,
                hs.status, hs.submission_notes as submissionNotes, hs.teacher_feedback as teacherFeedback
         FROM homework_submissions hs
         JOIN students s ON s.id = hs.student_id
         WHERE hs.homework_id = ?`
      )
      .all(hid) as Array<Record<string, unknown>>;

    const computed = submissions.map((s) => ({
      ...s,
      effectiveStatus: s.status === 'PENDING' && due < todayIso ? 'OVERDUE' : s.status,
    }));

    return { ...hw, submissions: computed };
  });

  res.json({ homework: enriched });
});

academicsRouter.post('/homework', requirePermission(Permission.HOMEWORK_MANAGE), (req, res) => {
  const schema = z.object({
    branchId: z.number().int().positive(),
    batchId: z.number().int().positive(),
    subjectId: z.number().int().positive(),
    teacherId: z.number().int().positive().optional(),
    chapterName: z.string().min(2),
    title: z.string().min(3),
    instructions: z.string().min(5),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
  const effectiveTeacherId =
    req.authUser!.teacherId ||
    d.teacherId ||
    (db.prepare('SELECT id FROM teachers WHERE primary_branch_id = ? LIMIT 1').get(scope.branchId) as { id: number } | undefined)?.id ||
    1;

  const hwId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO homework (branch_id, batch_id, subject_id, assigned_by_teacher_id, chapter_name, title, instructions, due_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        scope.branchId,
        d.batchId,
        d.subjectId,
        effectiveTeacherId,
        d.chapterName.trim(),
        d.title.trim(),
        d.instructions.trim(),
        d.dueDate,
        new Date().toISOString()
      );
    const id = Number(info.lastInsertRowid);
    const enrolled = db
      .prepare('SELECT student_id FROM enrolments WHERE batch_id = ? AND status = \'ACTIVE\'')
      .all(d.batchId) as Array<{ student_id: number }>;
    const insSub = db.prepare(
      'INSERT OR IGNORE INTO homework_submissions (homework_id, student_id, status) VALUES (?, ?, \'PENDING\')'
    );
    for (const e of enrolled) {
      insSub.run(id, e.student_id);
    }
    return id;
  })();

  dispatchNotification({
    branchId: scope.branchId,
    eventType: 'HOMEWORK_ASSIGNED',
    title: `New Homework: ${d.title}`,
    message: `Due on ${d.dueDate} (${d.chapterName}).`,
    channels: ['IN_APP'],
    createdByUserId: req.authUser!.id,
  });

  res.status(201).json({ id: hwId });
});

academicsRouter.patch('/homework-submissions/:id', requirePermission(Permission.HOMEWORK_MANAGE), (req, res) => {
  const subId = Number(req.params.id);
  const schema = z.object({
    status: z.enum(['PENDING', 'SUBMITTED', 'REVIEWED']),
    teacherFeedback: z.string().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  const nowIso = new Date().toISOString();
  db.prepare(
    'UPDATE homework_submissions SET status = ?, teacher_feedback = ?, reviewed_at = ? WHERE id = ?'
  ).run(parsed.data.status, parsed.data.teacherFeedback.trim(), nowIso, subId);
  res.json({ ok: true });
});
