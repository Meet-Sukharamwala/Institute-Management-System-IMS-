import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { requirePermission, resolveScopedBranchId } from '../auth';
import { Permission, RoleCode } from '../../shared/types';
import {
  generateReadableChallengeCode,
  generateSecureToken,
  hashVerificationSecret,
  verifyVerificationSecret,
} from '../crypto';
import { validateVerificationChallenge } from '../../shared/domain-logic';
import { writeAuditLog } from '../audit';
import { dispatchNotification } from '../notifications';

export const attendanceRouter = Router();

// ======================== A. CLASSROOM STUDENT ATTENDANCE ========================
attendanceRouter.get('/student-attendance/session/:sessionId', requirePermission(Permission.ATTENDANCE_STUDENT_MARK, Permission.STUDENT_VIEW), (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const db = getDb();
  const ses = db
    .prepare(
      `SELECT cs.id, cs.session_code as sessionCode, cs.branch_id as branchId, cs.batch_id as batchId,
              cs.session_date as sessionDate, bt.name as batchName, sub.name as subjectName
       FROM class_sessions cs
       JOIN batches bt ON bt.id = cs.batch_id
       JOIN subjects sub ON sub.id = cs.subject_id
       WHERE cs.id = ?`
    )
    .get(sessionId) as
    | { id: number; sessionCode: string; branchId: number; batchId: number; sessionDate: string; batchName: string; subjectName: string }
    | undefined;

  if (!ses) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Class session not found.' });
    return;
  }
  const scope = resolveScopedBranchId(req.authUser!, ses.branchId);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Branch restriction.' });
    return;
  }

  const roster = db
    .prepare(
      `SELECT s.id as studentId, s.student_code as studentCode, s.full_name as fullName,
              COALESCE(sa.status, 'NOT_RECORDED') as status,
              sa.previous_status as previousStatus,
              sa.correction_reason as correctionReason,
              sa.updated_at as updatedAt,
              EXISTS (
                SELECT 1 FROM leave_requests lr
                WHERE lr.student_id = s.id AND lr.status = 'APPROVED'
                  AND lr.start_date <= ? AND lr.end_date >= ?
              ) as hasApprovedLeave
       FROM enrolments e
       JOIN students s ON s.id = e.student_id
       LEFT JOIN student_attendance sa ON sa.student_id = s.id AND sa.class_session_id = ?
       WHERE e.batch_id = ? AND e.status = 'ACTIVE' AND s.status = 'ACTIVE'
       ORDER BY s.full_name ASC`
    )
    .all(ses.sessionDate, ses.sessionDate, sessionId, ses.batchId);

  res.json({ session: ses, roster });
});

attendanceRouter.post('/student-attendance/session/:sessionId', requirePermission(Permission.ATTENDANCE_STUDENT_MARK), (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const schema = z.object({
    entries: z
      .array(
        z.object({
          studentId: z.number().int().positive(),
          status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'APPROVED_LEAVE']),
          correctionReason: z.string().default(''),
        })
      )
      .min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }

  const db = getDb();
  const ses = db
    .prepare(
      'SELECT id, session_code, branch_id, assigned_teacher_id, substitute_teacher_id FROM class_sessions WHERE id = ?'
    )
    .get(sessionId) as
    | {
        id: number;
        session_code: string;
        branch_id: number;
        assigned_teacher_id: number;
        substitute_teacher_id: number | null;
      }
    | undefined;
  if (!ses) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Class session not found.' });
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
        message: 'You are not assigned to mark attendance for this session.',
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

  const canOverride = u.permissions.includes(Permission.ATTENDANCE_STUDENT_OVERRIDE);
  const nowIso = new Date().toISOString();
  const corrections: Array<{ studentId: number; from: string; to: string }> = [];

  try {
    db.transaction(() => {
      for (const item of parsed.data.entries) {
        const existing = db
          .prepare('SELECT id, status FROM student_attendance WHERE class_session_id = ? AND student_id = ?')
          .get(sessionId, item.studentId) as { id: number; status: string } | undefined;

        if (!existing) {
          db.prepare(
            `INSERT INTO student_attendance (class_session_id, student_id, status, recorded_by_user_id, correction_reason, recorded_at, updated_at)
             VALUES (?, ?, ?, ?, '', ?, ?)`
          ).run(sessionId, item.studentId, item.status, u.id, nowIso, nowIso);

          if (item.status === 'ABSENT') {
            dispatchNotification({
              branchId: ses.branch_id,
              eventType: 'STUDENT_ABSENT',
              title: `Classroom Absence Recorded (${ses.session_code})`,
              message: `Student ID #${item.studentId} marked absent in scheduled session ${ses.session_code}.`,
              channels: ['IN_APP'],
              dedupeKey: `abs-${sessionId}-${item.studentId}`,
              createdByUserId: u.id,
            });
          }
        } else if (existing.status !== item.status) {
          if (!canOverride) {
            throw new Error(
              'Attendance already recorded. Modifying existing attendance requires attendance:student_override permission.'
            );
          }
          if (!item.correctionReason.trim()) {
            throw new Error('A correction reason is mandatory when overriding recorded attendance.');
          }
          db.prepare(
            `UPDATE student_attendance
             SET previous_status = ?, status = ?, recorded_by_user_id = ?, correction_reason = ?, updated_at = ?
             WHERE id = ?`
          ).run(existing.status, item.status, u.id, item.correctionReason.trim(), nowIso, existing.id);
          corrections.push({ studentId: item.studentId, from: existing.status, to: item.status });
        }
      }
    })();
  } catch (err: unknown) {
    res.status(403).json({
      error: 'ATTENDANCE_CORRECTION_RESTRICTED',
      message: err instanceof Error ? err.message : 'Could not update attendance.',
    });
    return;
  }

  if (corrections.length > 0) {
    writeAuditLog({
      actor: u,
      branchId: ses.branch_id,
      action: 'STUDENT_ATTENDANCE_CORRECTED',
      entityType: 'student_attendance',
      entityId: ses.session_code,
      after: corrections,
    });
  }

  res.json({ ok: true, correctionsCount: corrections.length });
});

// ======================== B. CAMPUS ENTRY / EXIT MOVEMENT LOGS ========================
// Kept strictly independent of classroom attendance (entry scan never auto-marks classroom attendance)
attendanceRouter.get('/student-movements', requirePermission(Permission.MOVEMENT_RECORD, Permission.STUDENT_VIEW), (req, res) => {
  const scope = resolveScopedBranchId(req.authUser!, req.query.branchId as string | undefined);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch.' });
    return;
  }
  const dateFilter = String(req.query.date || '').trim();
  const onlyExceptions = req.query.exceptionsOnly === 'true';
  const db = getDb();

  let where = 'WHERE 1=1';
  const params: Array<string | number> = [];
  if (scope.branchId !== null) {
    where += ' AND sm.branch_id = ?';
    params.push(scope.branchId);
  }
  if (dateFilter) {
    where += ' AND sm.movement_date = ?';
    params.push(dateFilter);
  }
  if (onlyExceptions) {
    where += ' AND (sm.exit_time IS NULL OR sm.exception_flag = 1)';
  }

  const movements = db
    .prepare(
      `SELECT sm.id, sm.student_id as studentId, s.student_code as studentCode, s.full_name as studentName,
              sm.branch_id as branchId, b.name as branchName,
              sm.movement_date as movementDate, sm.entry_time as entryTime, sm.exit_time as exitTime,
              sm.recording_method as recordingMethod, u.full_name as operatorName,
              sm.exception_flag as exceptionFlag, sm.exception_reason as exceptionReason,
              sm.resolved_by_user_id as resolvedByUserId
       FROM student_movements sm
       JOIN students s ON s.id = sm.student_id
       JOIN branches b ON b.id = sm.branch_id
       JOIN users u ON u.id = sm.recorded_by_user_id
       ${where}
       ORDER BY sm.id DESC LIMIT 100`
    )
    .all(...params);

  res.json({ movements });
});

attendanceRouter.post('/student-movements/entry', requirePermission(Permission.MOVEMENT_RECORD), (req, res) => {
  const schema = z.object({
    studentId: z.number().int().positive(),
    branchId: z.number().int().positive(),
    movementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    entryTime: z.string().regex(/^\d{2}:\d{2}$/),
    recordingMethod: z.enum(['STAFF_DESK', 'QR_BADGE', 'RFID_GATE']).default('STAFF_DESK'),
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
  const openLog = db
    .prepare(
      'SELECT id FROM student_movements WHERE student_id = ? AND movement_date = ? AND exit_time IS NULL'
    )
    .get(d.studentId, d.movementDate) as { id: number } | undefined;
  if (openLog) {
    res.status(409).json({
      error: 'OPEN_MOVEMENT_EXISTS',
      message: 'Student already has an active campus entry without an exit record today.',
    });
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO student_movements (student_id, branch_id, movement_date, entry_time, recording_method, recorded_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      d.studentId,
      scope.branchId,
      d.movementDate,
      d.entryTime,
      d.recordingMethod,
      req.authUser!.id,
      new Date().toISOString()
    );

  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

attendanceRouter.patch('/student-movements/:id/exit', requirePermission(Permission.MOVEMENT_RECORD), (req, res) => {
  const movementId = Number(req.params.id);
  const schema = z.object({
    exitTime: z.string().regex(/^\d{2}:\d{2}$/),
    exceptionReason: z.string().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  const row = db
    .prepare('SELECT id, branch_id, entry_time FROM student_movements WHERE id = ?')
    .get(movementId) as { id: number; branch_id: number; entry_time: string } | undefined;
  if (!row) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Movement log not found.' });
    return;
  }
  const scope = resolveScopedBranchId(req.authUser!, row.branch_id);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch.' });
    return;
  }
  if (parsed.data.exitTime < row.entry_time) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Exit time cannot be earlier than entry time.' });
    return;
  }

  db.prepare(
    `UPDATE student_movements
     SET exit_time = ?, exception_flag = 0, exception_reason = ?, resolved_by_user_id = ?
     WHERE id = ?`
  ).run(parsed.data.exitTime, parsed.data.exceptionReason.trim(), req.authUser!.id, movementId);

  res.json({ ok: true });
});

// ======================== C. STRICT TEACHER VERIFICATION & CHECKOUT ========================
const teacherVerifyRateMap = new Map<number, { fails: number; resetAtMs: number }>();

attendanceRouter.get('/teacher-attendance', requirePermission(Permission.TEACHER_VERIFICATION_HOST, Permission.TEACHER_VERIFICATION_CHECKIN, Permission.TEACHER_VIEW), (req, res) => {
  const u = req.authUser!;
  const scope = resolveScopedBranchId(u, req.query.branchId as string | undefined);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch.' });
    return;
  }
  const dateStr = String(req.query.date || new Date().toISOString().slice(0, 10)).trim();
  const db = getDb();

  const isHost = u.permissions.includes(Permission.TEACHER_VERIFICATION_HOST);

  // Challenges: never expose code_hash or salt in API response
  let challengeSql = `
    SELECT vc.id, vc.challenge_uid as challengeUid, vc.branch_id as branchId, b.name as branchName,
           vc.display_hint as displayHint, vc.applicable_teacher_id as applicableTeacherId,
           t.full_name as applicableTeacherName, vc.usage_policy as usagePolicy,
           vc.created_at_ms as createdAtMs, vc.expires_at_ms as expiresAtMs,
           vc.is_active as isActive, vc.is_revoked as isRevoked, vc.consumption_count as consumptionCount,
           u2.full_name as issuedByName
    FROM verification_challenges vc
    JOIN branches b ON b.id = vc.branch_id
    JOIN users u2 ON u2.id = vc.issued_by_user_id
    LEFT JOIN teachers t ON t.id = vc.applicable_teacher_id
    WHERE 1=1
  `;
  const chParams: Array<number | string> = [];
  if (scope.branchId !== null) {
    challengeSql += ' AND vc.branch_id = ?';
    chParams.push(scope.branchId);
  }
  challengeSql += ' ORDER BY vc.id DESC LIMIT 20';
  const challenges = db.prepare(challengeSql).all(...chParams);

  let attSql = `
    SELECT ta.id, ta.teacher_id as teacherId, t.employee_code as employeeCode, t.full_name as teacherName,
           ta.branch_id as branchId, b.name as branchName, ta.attendance_date as attendanceDate,
           ta.check_in_at as checkInAt, ta.check_out_at as checkOutAt, ta.duration_minutes as durationMinutes,
           ta.verification_method as verificationMethod, ta.status, ta.override_reason as overrideReason
    FROM teacher_attendance ta
    JOIN teachers t ON t.id = ta.teacher_id
    JOIN branches b ON b.id = ta.branch_id
    WHERE ta.attendance_date = ?
  `;
  const attParams: Array<number | string> = [dateStr];
  if (u.roleCode === RoleCode.TEACHER && u.teacherId && !isHost) {
    attSql += ' AND ta.teacher_id = ?';
    attParams.push(u.teacherId);
  } else if (scope.branchId !== null) {
    attSql += ' AND ta.branch_id = ?';
    attParams.push(scope.branchId);
  }
  attSql += ' ORDER BY ta.id DESC';
  const records = db.prepare(attSql).all(...attParams);

  const failedAttempts = isHost
    ? db
        .prepare(
          `SELECT va.id, t.full_name as teacherName, b.name as branchName,
                  va.failure_reason as failureReason, va.attempted_at as attemptedAt
           FROM verification_attempts va
           JOIN teachers t ON t.id = va.teacher_id
           JOIN branches b ON b.id = va.branch_id
           WHERE va.succeeded = 0 ${scope.branchId !== null ? 'AND va.branch_id = ?' : ''}
           ORDER BY va.id DESC LIMIT 25`
        )
        .all(...(scope.branchId !== null ? [scope.branchId] : []))
    : [];

  res.json({
    serverTimeIso: new Date().toISOString(),
    serverNowMs: Date.now(),
    challenges,
    records,
    failedAttempts,
  });
});

/**
 * Host generates a short-lived verification challenge.
 * The plaintext code is returned ONCE to the authorized Host who generated it
 * so it can be displayed on the reception kiosk/board, while ONLY the salted HMAC hash
 * is persisted in the database. Subsequent GET requests never expose the code.
 */
attendanceRouter.post('/teacher-attendance/challenges', requirePermission(Permission.TEACHER_VERIFICATION_HOST), (req, res) => {
  const schema = z.object({
    branchId: z.number().int().positive(),
    validityMinutes: z.number().int().min(2).max(720).default(30),
    applicableTeacherId: z.number().int().positive().nullable().default(null),
    usagePolicy: z.enum(['ONE_TIME_PER_TEACHER', 'SINGLE_USE_GLOBAL']).default('ONE_TIME_PER_TEACHER'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const d = parsed.data;
  const scope = resolveScopedBranchId(req.authUser!, d.branchId);
  if (!scope.allowed || !scope.branchId) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Cannot issue challenge for unauthorized branch.' });
    return;
  }

  const plainCode = generateReadableChallengeCode(6);
  const salt = generateSecureToken(12);
  const codeHash = hashVerificationSecret(plainCode, salt);
  const displayHint = `${plainCode.slice(0, 2)}****`;
  const nowMs = Date.now();
  const expiresAtMs = nowMs + d.validityMinutes * 60_000;
  const challengeUid = `CHL-${scope.branchId}-${String(nowMs).slice(-6)}`;

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO verification_challenges (
        challenge_uid, branch_id, code_hash, salt, display_hint, issued_by_user_id,
        applicable_teacher_id, usage_policy, created_at_ms, expires_at_ms, is_active, is_revoked, consumption_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0)`
    )
    .run(
      challengeUid,
      scope.branchId,
      codeHash,
      salt,
      displayHint,
      req.authUser!.id,
      d.applicableTeacherId,
      d.usagePolicy,
      nowMs,
      expiresAtMs
    );

  writeAuditLog({
    actor: req.authUser!,
    branchId: scope.branchId,
    action: 'VERIFICATION_CHALLENGE_ISSUED',
    entityType: 'verification_challenges',
    entityId: challengeUid,
    after: {
      branchId: scope.branchId,
      validityMinutes: d.validityMinutes,
      usagePolicy: d.usagePolicy,
      applicableTeacherId: d.applicableTeacherId,
    },
  });

  res.status(201).json({
    id: Number(info.lastInsertRowid),
    challengeUid,
    issuedOneTimePlainCode: plainCode,
    expiresAtMs,
  });
});

attendanceRouter.post('/teacher-attendance/challenges/:id/revoke', requirePermission(Permission.TEACHER_VERIFICATION_HOST), (req, res) => {
  const challengeId = Number(req.params.id);
  const db = getDb();
  const ch = db
    .prepare('SELECT id, challenge_uid, branch_id FROM verification_challenges WHERE id = ?')
    .get(challengeId) as { id: number; challenge_uid: string; branch_id: number } | undefined;
  if (!ch) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Challenge not found.' });
    return;
  }
  const scope = resolveScopedBranchId(req.authUser!, ch.branch_id);
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch.' });
    return;
  }
  db.prepare(
    'UPDATE verification_challenges SET is_revoked = 1, is_active = 0, revoked_at = ? WHERE id = ?'
  ).run(new Date().toISOString(), challengeId);

  writeAuditLog({
    actor: req.authUser!,
    branchId: ch.branch_id,
    action: 'VERIFICATION_CHALLENGE_REVOKED',
    entityType: 'verification_challenges',
    entityId: ch.challenge_uid,
  });
  res.json({ ok: true });
});

attendanceRouter.post('/teacher-attendance/check-in', requirePermission(Permission.TEACHER_VERIFICATION_CHECKIN), (req, res) => {
  const u = req.authUser!;
  if (!u.teacherId) {
    res.status(403).json({
      error: 'NOT_A_TEACHER_PROFILE',
      message: 'Individual faculty account authentication is required for verified check-in.',
    });
    return;
  }

  const nowMs = Date.now();
  const rl = teacherVerifyRateMap.get(u.teacherId);
  if (rl && nowMs < rl.resetAtMs && rl.fails >= 5) {
    res.status(429).json({
      error: 'RATE_LIMITED',
      message: 'Too many failed verification attempts. Wait 5 minutes or request host assistance.',
    });
    return;
  }

  const schema = z.object({
    branchId: z.number().int().positive(),
    code: z.string().min(4).max(16),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Branch and valid verification code are required.' });
    return;
  }

  const { branchId, code } = parsed.data;
  const db = getDb();
  const todayStr = new Date(nowMs).toISOString().slice(0, 10);
  const serverTimeHHMM = new Date(nowMs).toTimeString().slice(0, 5);

  const existingAtt = db
    .prepare('SELECT id, status FROM teacher_attendance WHERE teacher_id = ? AND attendance_date = ?')
    .get(u.teacherId, todayStr) as { id: number; status: string } | undefined;

  if (existingAtt) {
    res.status(409).json({
      error: 'DUPLICATE_CHECKIN',
      message: `Check-in already recorded for ${todayStr} (status: ${existingAtt.status}).`,
    });
    return;
  }

  const assignedBranches = (
    db
      .prepare('SELECT branch_id FROM teacher_branches WHERE teacher_id = ?')
      .all(u.teacherId) as Array<{ branch_id: number }>
  ).map((r) => r.branch_id);

  // Locate candidate active challenges in that branch
  const candidates = db
    .prepare(
      `SELECT id, challenge_uid, branch_id, code_hash, salt, applicable_teacher_id,
              usage_policy, expires_at_ms, is_active, is_revoked, consumption_count
       FROM verification_challenges
       WHERE branch_id = ?
       ORDER BY id DESC LIMIT 15`
    )
    .all(branchId) as Array<{
    id: number;
    challenge_uid: string;
    branch_id: number;
    code_hash: string;
    salt: string;
    applicable_teacher_id: number | null;
    usage_policy: 'ONE_TIME_PER_TEACHER' | 'SINGLE_USE_GLOBAL';
    expires_at_ms: number;
    is_active: number;
    is_revoked: number;
    consumption_count: number;
  }>;

  let matchedChallenge: (typeof candidates)[number] | null = null;
  let failureReason = 'Invalid or unrecognized verification challenge code.';

  for (const ch of candidates) {
    const hashMatches = verifyVerificationSecret(code, ch.salt, ch.code_hash);
    if (!hashMatches) continue;

    const alreadyConsumed = Boolean(
      db
        .prepare('SELECT 1 FROM teacher_attendance WHERE challenge_id = ? AND teacher_id = ?')
        .get(ch.id, u.teacherId)
    );

    const ruleRes = validateVerificationChallenge({
      isActive: Boolean(ch.is_active),
      isRevoked: Boolean(ch.is_revoked),
      expiresAtMs: ch.expires_at_ms,
      nowMs,
      challengeBranchId: ch.branch_id,
      teacherBranchIds: assignedBranches,
      applicableTeacherId: ch.applicable_teacher_id,
      requestingTeacherId: u.teacherId,
      usagePolicy: ch.usage_policy,
      alreadyConsumedByTeacher: alreadyConsumed,
      totalConsumptionCount: ch.consumption_count,
      codeHashMatches: true,
    });

    if (ruleRes.valid) {
      matchedChallenge = ch;
      break;
    } else {
      failureReason = ruleRes.reason || failureReason;
      break;
    }
  }

  if (!matchedChallenge) {
    teacherVerifyRateMap.set(u.teacherId, {
      fails: (rl && nowMs < rl.resetAtMs ? rl.fails : 0) + 1,
      resetAtMs: rl && nowMs < rl.resetAtMs ? rl.resetAtMs : nowMs + 5 * 60_000,
    });
    db.prepare(
      `INSERT INTO verification_attempts (challenge_id, teacher_id, branch_id, succeeded, failure_reason, attempted_at_ms, attempted_at)
       VALUES (NULL, ?, ?, 0, ?, ?, ?)`
    ).run(u.teacherId, branchId, failureReason, nowMs, new Date(nowMs).toISOString());

    res.status(400).json({ error: 'VERIFICATION_FAILED', message: failureReason });
    return;
  }

  const attId = db.transaction(() => {
    db.prepare(
      `UPDATE verification_challenges
       SET consumption_count = consumption_count + 1,
           is_active = CASE WHEN usage_policy = 'SINGLE_USE_GLOBAL' THEN 0 ELSE is_active END
       WHERE id = ?`
    ).run(matchedChallenge!.id);

    db.prepare(
      `INSERT INTO verification_attempts (challenge_id, teacher_id, branch_id, succeeded, failure_reason, attempted_at_ms, attempted_at)
       VALUES (?, ?, ?, 1, '', ?, ?)`
    ).run(matchedChallenge!.id, u.teacherId!, branchId, nowMs, new Date(nowMs).toISOString());

    const ins = db
      .prepare(
        `INSERT INTO teacher_attendance (
          teacher_id, branch_id, attendance_date, challenge_id, check_in_at, check_in_ms, verification_method, status
        ) VALUES (?, ?, ?, ?, ?, ?, 'CHALLENGE_CODE', 'CHECKED_IN')`
      )
      .run(u.teacherId!, branchId, todayStr, matchedChallenge!.id, serverTimeHHMM, nowMs);
    return Number(ins.lastInsertRowid);
  })();

  writeAuditLog({
    actor: u,
    branchId,
    action: 'TEACHER_VERIFIED_CHECKIN',
    entityType: 'teacher_attendance',
    entityId: attId,
    after: { challengeUid: matchedChallenge.challenge_uid, serverTimeHHMM },
  });

  res.status(201).json({
    id: attId,
    checkInAt: serverTimeHHMM,
    attendanceDate: todayStr,
    message: `Verified check-in recorded at ${serverTimeHHMM} (server clock).`,
  });
});

attendanceRouter.post('/teacher-attendance/check-out', requirePermission(Permission.TEACHER_VERIFICATION_CHECKIN), (req, res) => {
  const u = req.authUser!;
  if (!u.teacherId) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Teacher profile required.' });
    return;
  }
  const nowMs = Date.now();
  const todayStr = new Date(nowMs).toISOString().slice(0, 10);
  const serverOutHHMM = new Date(nowMs).toTimeString().slice(0, 5);
  const db = getDb();

  const rec = db
    .prepare(
      'SELECT id, branch_id, check_in_ms, check_out_ms FROM teacher_attendance WHERE teacher_id = ? AND attendance_date = ?'
    )
    .get(u.teacherId, todayStr) as
    | { id: number; branch_id: number; check_in_ms: number; check_out_ms: number | null }
    | undefined;

  if (!rec) {
    res.status(400).json({ error: 'NO_ACTIVE_CHECKIN', message: 'No active check-in found for today.' });
    return;
  }
  if (rec.check_out_ms) {
    res.status(409).json({ error: 'ALREADY_CHECKED_OUT', message: 'Checkout has already been recorded today.' });
    return;
  }

  const durationMinutes = Math.max(1, Math.round((nowMs - rec.check_in_ms) / 60_000));
  const status = durationMinutes < 15 || durationMinutes > 720 ? 'EXCEPTION_FLAGGED' : 'CHECKED_OUT';

  db.prepare(
    `UPDATE teacher_attendance
     SET check_out_at = ?, check_out_ms = ?, duration_minutes = ?, status = ?
     WHERE id = ?`
  ).run(serverOutHHMM, nowMs, durationMinutes, status, rec.id);

  writeAuditLog({
    actor: u,
    branchId: rec.branch_id,
    action: 'TEACHER_CHECKOUT',
    entityType: 'teacher_attendance',
    entityId: rec.id,
    after: { checkOutAt: serverOutHHMM, durationMinutes, status },
  });

  res.json({ ok: true, checkOutAt: serverOutHHMM, durationMinutes, status });
});

attendanceRouter.post('/teacher-attendance/override', requirePermission(Permission.TEACHER_VERIFICATION_HOST), (req, res) => {
  if (
    req.authUser!.roleCode !== RoleCode.SUPER_ADMIN &&
    req.authUser!.roleCode !== RoleCode.BRANCH_ADMIN
  ) {
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Manual teacher attendance overrides are restricted to Branch or Super Administrators.',
    });
    return;
  }
  const schema = z.object({
    teacherId: z.number().int().positive(),
    branchId: z.number().int().positive(),
    attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checkInAt: z.string().regex(/^\d{2}:\d{2}$/),
    checkOutAt: z.string().regex(/^\d{2}:\d{2}$/),
    durationMinutes: z.number().int().min(1).max(960),
    overrideReason: z.string().min(5, 'Detailed audit reason is mandatory for manual override'),
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
  const nowMs = Date.now();
  db.prepare(
    `INSERT INTO teacher_attendance (
      teacher_id, branch_id, attendance_date, check_in_at, check_in_ms, check_out_at, check_out_ms,
      duration_minutes, verification_method, status, override_reason, overridden_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL_ADMIN_OVERRIDE', 'MANUAL_OVERRIDE', ?, ?)
    ON CONFLICT(teacher_id, attendance_date) DO UPDATE SET
      check_in_at = excluded.check_in_at,
      check_out_at = excluded.check_out_at,
      duration_minutes = excluded.duration_minutes,
      status = 'MANUAL_OVERRIDE',
      override_reason = excluded.override_reason,
      overridden_by_user_id = excluded.overridden_by_user_id`
  ).run(
    d.teacherId,
    scope.branchId,
    d.attendanceDate,
    d.checkInAt,
    nowMs,
    d.checkOutAt,
    nowMs,
    d.durationMinutes,
    d.overrideReason.trim(),
    req.authUser!.id
  );

  writeAuditLog({
    actor: req.authUser!,
    branchId: scope.branchId,
    action: 'TEACHER_ATTENDANCE_OVERRIDDEN',
    entityType: 'teacher_attendance',
    entityId: `${d.teacherId}:${d.attendanceDate}`,
    after: d,
  });

  res.json({ ok: true });
});

// ======================== D. LEAVE & HOLIDAY MANAGEMENT ========================
attendanceRouter.get('/leave-requests', requirePermission(Permission.LEAVE_REQUEST, Permission.LEAVE_APPROVE), (req, res) => {
  const u = req.authUser!;
  const scope = resolveScopedBranchId(u, req.query.branchId as string | undefined);
  if (!scope.allowed && u.roleCode !== RoleCode.STUDENT) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch.' });
    return;
  }
  const db = getDb();
  let where = 'WHERE 1=1';
  const params: Array<string | number> = [];

  if (u.roleCode === RoleCode.TEACHER && u.teacherId && !u.permissions.includes(Permission.LEAVE_APPROVE)) {
    where += ' AND lr.teacher_id = ?';
    params.push(u.teacherId);
  } else if (u.roleCode === RoleCode.STUDENT && u.studentId) {
    where += ' AND lr.student_id = ?';
    params.push(u.studentId);
  } else if (scope.branchId !== null) {
    where += ' AND lr.branch_id = ?';
    params.push(scope.branchId);
  }

  const leaves = db
    .prepare(
      `SELECT lr.id, lr.applicant_type as applicantType, lr.teacher_id as teacherId, t.full_name as teacherName,
              lr.student_id as studentId, s.full_name as studentName, lr.branch_id as branchId, b.name as branchName,
              lr.leave_type as leaveType, lr.is_paid as isPaid, lr.start_date as startDate, lr.end_date as endDate,
              lr.days_count as daysCount, lr.reason, lr.status, lr.review_remarks as reviewRemarks, lr.created_at as createdAt
       FROM leave_requests lr
       JOIN branches b ON b.id = lr.branch_id
       LEFT JOIN teachers t ON t.id = lr.teacher_id
       LEFT JOIN students s ON s.id = lr.student_id
       ${where}
       ORDER BY lr.id DESC`
    )
    .all(...params);

  const holidays = db
    .prepare(
      `SELECT h.id, h.branch_id as branchId, b.name as branchName, h.holiday_date as holidayDate, h.title, h.description
       FROM holidays h
       LEFT JOIN branches b ON b.id = h.branch_id
       WHERE h.branch_id IS NULL ${scope.branchId !== null ? 'OR h.branch_id = ?' : ''}
       ORDER BY h.holiday_date ASC`
    )
    .all(...(scope.branchId !== null ? [scope.branchId] : []));

  res.json({ leaves, holidays });
});

attendanceRouter.post('/leave-requests', requirePermission(Permission.LEAVE_REQUEST, Permission.LEAVE_APPROVE), (req, res) => {
  const schema = z.object({
    applicantType: z.enum(['TEACHER', 'STUDENT']),
    teacherId: z.number().int().positive().optional(),
    studentId: z.number().int().positive().optional(),
    branchId: z.number().int().positive().optional(),
    leaveType: z.enum(['CASUAL', 'MEDICAL', 'UNPAID', 'ACADEMIC']),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    daysCount: z.number().int().min(1).max(60),
    reason: z.string().min(4),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const d = parsed.data;
  const u = req.authUser!;
  const effectiveTeacherId = u.roleCode === RoleCode.TEACHER ? u.teacherId : d.teacherId;
  const effectiveStudentId = u.roleCode === RoleCode.STUDENT ? u.studentId : d.studentId;
  const effectiveBranchId = u.branchId || d.branchId || 1;
  const isPaid = d.leaveType === 'UNPAID' ? 0 : 1;

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO leave_requests (
        applicant_type, teacher_id, student_id, branch_id, leave_type, is_paid,
        start_date, end_date, days_count, reason, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`
    )
    .run(
      d.applicantType,
      effectiveTeacherId ?? null,
      effectiveStudentId ?? null,
      effectiveBranchId,
      d.leaveType,
      isPaid,
      d.startDate,
      d.endDate,
      d.daysCount,
      d.reason.trim(),
      new Date().toISOString()
    );

  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

attendanceRouter.patch('/leave-requests/:id/review', requirePermission(Permission.LEAVE_APPROVE), (req, res) => {
  const leaveId = Number(req.params.id);
  const schema = z.object({
    status: z.enum(['APPROVED', 'REJECTED']),
    isPaid: z.boolean().optional(),
    reviewRemarks: z.string().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  const lv = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(leaveId) as
    | Record<string, unknown>
    | undefined;
  if (!lv) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Leave request not found.' });
    return;
  }
  const scope = resolveScopedBranchId(req.authUser!, Number(lv.branch_id));
  if (!scope.allowed) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Unauthorized branch.' });
    return;
  }

  db.prepare(
    `UPDATE leave_requests
     SET status = ?, is_paid = COALESCE(?, is_paid), reviewed_by_user_id = ?, review_remarks = ?, reviewed_at = ?
     WHERE id = ?`
  ).run(
    parsed.data.status,
    parsed.data.isPaid !== undefined ? (parsed.data.isPaid ? 1 : 0) : null,
    req.authUser!.id,
    parsed.data.reviewRemarks.trim(),
    new Date().toISOString(),
    leaveId
  );

  writeAuditLog({
    actor: req.authUser!,
    branchId: Number(lv.branch_id),
    action: `LEAVE_${parsed.data.status}`,
    entityType: 'leave_requests',
    entityId: leaveId,
    after: parsed.data,
  });

  res.json({ ok: true });
});

attendanceRouter.post('/holidays', requirePermission(Permission.LEAVE_APPROVE), (req, res) => {
  const schema = z.object({
    branchId: z.number().int().positive().nullable().default(null),
    holidayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().min(3),
    description: z.string().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }
  const db = getDb();
  const info = db
    .prepare('INSERT INTO holidays (branch_id, holiday_date, title, description) VALUES (?, ?, ?, ?)')
    .run(
      parsed.data.branchId,
      parsed.data.holidayDate,
      parsed.data.title.trim(),
      parsed.data.description.trim()
    );
  dispatchNotification({
    branchId: parsed.data.branchId,
    eventType: 'HOLIDAY_ANNOUNCEMENT',
    title: `Holiday Declared: ${parsed.data.title} (${parsed.data.holidayDate})`,
    message: parsed.data.description || 'Academic sessions will remain suspended on this date.',
    channels: ['IN_APP'],
    createdByUserId: req.authUser!.id,
  });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});
