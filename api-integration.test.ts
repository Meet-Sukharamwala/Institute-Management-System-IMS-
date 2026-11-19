import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ims-api-test-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'test-ims.sqlite');
process.env.NODE_ENV = 'development';

import { createApiApp } from './app';
import { closeAndResetDbInstance } from './db';
import { DEV_SAMPLE_PASSWORD } from './seed';

let server: http.Server;
let baseUrl = '';

async function apiCall<T = Record<string, unknown>>(
  endpoint: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

test('Full-stack API Integration & Security Suite', async (t) => {
  const app = createApiApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  let createdBackupFilename = '';
  t.after(() => {
    server.close();
    closeAndResetDbInstance();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (createdBackupFilename) {
      const bakPath = path.resolve(process.cwd(), 'backups', createdBackupFilename);
      if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
    }
  });

  let superAdminToken = '';
  let kothrudBranchAdminToken = '';
  let studentToken = '';
  let parentToken = '';
  let vimanTeacherToken = '';

  await t.test('1. Authentication & session tokens succeed for valid credentials and reject wrong password', async () => {
    const bad = await apiCall('/api/auth/login', {
      method: 'POST',
      body: { email: 'director@nikenacademy.edu.in', password: 'WrongPassword123' },
    });
    assert.equal(bad.status, 401);

    const sa = await apiCall<{ sessionToken: string }>('/api/auth/login', {
      method: 'POST',
      body: { email: 'director@nikenacademy.edu.in', password: DEV_SAMPLE_PASSWORD },
    });
    assert.equal(sa.status, 200);
    superAdminToken = sa.data.sessionToken;

    const meRes = await apiCall<{ user: { fullName: string; roleCode: string; email: string } }>('/api/auth/me', {
      token: superAdminToken,
    });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.data.user.fullName, 'Niken Patel');
    assert.equal(meRes.data.user.roleCode, 'SUPER_ADMIN');
    assert.equal(meRes.data.user.email, 'director@nikenacademy.edu.in');

    // Provision test staff, teachers, course, batch, and students via Director API
    const baCreate = await apiCall('/api/users', {
      method: 'POST',
      token: superAdminToken,
      body: {
        fullName: 'Meera Kulkarni',
        email: 'kothrud.admin@nikenacademy.edu.in',
        phone: '+91-9822011002',
        password: DEV_SAMPLE_PASSWORD,
        roleCode: 'BRANCH_ADMIN',
        branchId: 1,
      },
    });
    assert.equal(baCreate.status, 201);

    // Create teacher in Branch 1 (Prof. Raghavendra Iyer)
    const t1Res = await apiCall('/api/teachers', {
      method: 'POST',
      token: superAdminToken,
      body: {
        fullName: 'Prof. Raghavendra Iyer',
        email: 'raghav.physics@nikenacademy.edu.in',
        phone: '+91-9823012001',
        designation: 'Head of Physics',
        employmentType: 'FULL_TIME',
        joiningDate: '2023-06-01',
        primaryBranchId: 1,
        additionalBranchIds: [2],
        subjectsCsv: 'Physics',
        salaryStructureId: 1,
        portalPassword: DEV_SAMPLE_PASSWORD,
        documentsNotes: 'M.Sc Physics IIT-B Verified',
      },
    });
    assert.equal(t1Res.status, 201);

    // Create teacher in Branch 2 (Dr. Vikramaditya Nair)
    const t2Res = await apiCall('/api/teachers', {
      method: 'POST',
      token: superAdminToken,
      body: {
        fullName: 'Dr. Vikramaditya Nair',
        email: 'vikram.chem@nikenacademy.edu.in',
        phone: '+91-9823012003',
        designation: 'Senior Chemistry Specialist',
        employmentType: 'FULL_TIME',
        joiningDate: '2024-01-15',
        primaryBranchId: 2,
        additionalBranchIds: [],
        subjectsCsv: 'Chemistry',
        salaryStructureId: 1,
        portalPassword: DEV_SAMPLE_PASSWORD,
        documentsNotes: 'Ph.D Chemistry Pune University',
      },
    });
    assert.equal(t2Res.status, 201);

    // Create Course with Physics subject and syllabus topics in Branch 1
    const courseRes = await apiCall<{ id: number }>('/api/courses', {
      method: 'POST',
      token: superAdminToken,
      body: {
        code: 'CRS-JEE27',
        name: 'IIT-JEE Advanced 2-Year Program',
        academicLevel: 'Class 12 Science',
        durationMonths: 24,
        startDate: '2026-06-01',
        endDate: '2027-05-30',
        defaultFeeInr: 120000,
        branchId: 1,
        initialSubjects: [
          {
            code: 'PHY-12',
            name: 'Physics',
            topics: [
              { chapterName: 'Rotational Dynamics', topicTitle: 'Moment of Inertia & Angular Momentum' },
              { chapterName: 'Rotational Dynamics', topicTitle: 'Parallel Axis Theorem & Rolling Motion' },
            ],
          },
        ],
      },
    });
    assert.equal(courseRes.status, 201);

    // Create Batch in Branch 1
    const batchRes = await apiCall<{ id: number }>('/api/batches', {
      method: 'POST',
      token: superAdminToken,
      body: {
        code: 'JEE-2027-MA',
        name: 'JEE 2027 Morning Alpha',
        courseId: courseRes.data.id,
        branchId: 1,
        classroom: 'Hall A-101',
        maxCapacity: 40,
        startDate: '2026-06-01',
        endDate: '2027-05-30',
        teacherId: 1,
        subjectId: 1,
      },
    });
    assert.equal(batchRes.status, 201);

    // Admit Student #1 (Aarav Sharma) with portal accounts in Branch 1
    const s1Admit = await apiCall('/api/students', {
      method: 'POST',
      token: superAdminToken,
      body: {
        fullName: 'Aarav Sharma',
        email: 'aarav.sharma@student.nikenacademy.edu.in',
        phone: '+91-9821013001',
        academicLevel: 'Class 12 Science',
        admissionDate: '2026-06-01',
        branchId: 1,
        batchId: batchRes.data.id,
        guardianName: 'Rajesh Sharma',
        guardianPhone: '+91-9821013002',
        guardianEmail: 'rajesh.sharma@parent.nikenacademy.edu.in',
        guardianRelation: 'FATHER',
        createPortalAccounts: true,
        portalPassword: DEV_SAMPLE_PASSWORD,
      },
    });
    assert.equal(s1Admit.status, 201);

    // Admit Student #2 (Diya Kulkarni) in Branch 2 (used for cross-branch & unlinked parent tests)
    const s2Admit = await apiCall('/api/students', {
      method: 'POST',
      token: superAdminToken,
      body: {
        fullName: 'Diya Kulkarni',
        email: 'diya.kulkarni@student.nikenacademy.edu.in',
        phone: '+91-9821013003',
        academicLevel: 'Class 12 Medical',
        admissionDate: '2026-06-05',
        branchId: 2,
        guardianName: 'Sanjay Kulkarni',
        guardianPhone: '+91-9821013004',
      },
    });
    assert.equal(s2Admit.status, 201);

    // Verify authentication succeeds for all roles
    const ba = await apiCall<{ sessionToken: string }>('/api/auth/login', {
      method: 'POST',
      body: { email: 'kothrud.admin@nikenacademy.edu.in', password: DEV_SAMPLE_PASSWORD },
    });
    assert.equal(ba.status, 200);
    kothrudBranchAdminToken = ba.data.sessionToken;

    const stu = await apiCall<{ sessionToken: string }>('/api/auth/login', {
      method: 'POST',
      body: { email: 'aarav.sharma@student.nikenacademy.edu.in', password: DEV_SAMPLE_PASSWORD },
    });
    assert.equal(stu.status, 200);
    studentToken = stu.data.sessionToken;

    const par = await apiCall<{ sessionToken: string }>('/api/auth/login', {
      method: 'POST',
      body: { email: 'rajesh.sharma@parent.nikenacademy.edu.in', password: DEV_SAMPLE_PASSWORD },
    });
    assert.equal(par.status, 200);
    parentToken = par.data.sessionToken;

    const vt = await apiCall<{ sessionToken: string }>('/api/auth/login', {
      method: 'POST',
      body: { email: 'vikram.chem@nikenacademy.edu.in', password: DEV_SAMPLE_PASSWORD },
    });
    assert.equal(vt.status, 200);
    vimanTeacherToken = vt.data.sessionToken;
  });

  await t.test('2. Security & Multi-Branch Isolation: unauthorized cross-branch, payroll, and guardian probes are denied (403)', async () => {
    // Kothrud Branch Admin (Branch 1) attempting to query Viman Nagar (Branch 2) students
    const crossBranch = await apiCall('/api/students?branchId=2', {
      token: kothrudBranchAdminToken,
    });
    assert.equal(crossBranch.status, 403);

    // Student attempting to access administrative student directory or payroll
    const stuAdminAttempt = await apiCall('/api/students', { token: studentToken });
    assert.equal(stuAdminAttempt.status, 403);
    const stuPayrollAttempt = await apiCall('/api/payroll', { token: studentToken });
    assert.equal(stuPayrollAttempt.status, 403);

    // Parent attempting to query unlinked student ID #2 (Diya Kulkarni)
    const unlinkedChild = await apiCall('/api/portal/parent?studentId=2', {
      token: parentToken,
    });
    assert.equal(unlinkedChild.status, 403);

    // Linked child query succeeds
    const linkedChild = await apiCall<{ children: Array<{ profile: { studentCode: string } }> }>(
      '/api/portal/parent',
      { token: parentToken }
    );
    assert.equal(linkedChild.status, 200);
    assert.equal(linkedChild.data.children.length, 1);
    assert.equal(linkedChild.data.children[0].profile.studentCode, 'STU-2026-001');
  });

  await t.test('3. End-to-End Student Admission + Fee Payment + Idempotency + Controlled Reversal', async () => {
    const admit = await apiCall<{ studentId: number; studentCode: string; receiptNumber: string }>(
      '/api/students',
      {
        method: 'POST',
        token: kothrudBranchAdminToken,
        body: {
          fullName: 'Tanvi Joshi',
          email: 'tanvi.joshi@example.edu.in',
          phone: '+91-9822990011',
          academicLevel: 'Class 12 Science',
          admissionDate: '2026-10-29',
          branchId: 1,
          batchId: 1,
          guardianName: 'Mahesh Joshi',
          guardianPhone: '+91-9822990010',
          initialFeeTitle: 'Annual JEE Composite Fee',
          initialFeeInr: 50000,
          discountInr: 5000,
          feeDueDate: '2026-11-10',
          initialPaymentInr: 20000,
          paymentMethod: 'UPI',
        },
      }
    );
    assert.equal(admit.status, 201);
    assert.ok(admit.data.receiptNumber);

    // Record second payment with idempotency key; replay must deduplicate cleanly
    const pay1 = await apiCall<{ id: number; receiptNumber: string }>('/api/payments', {
      method: 'POST',
      token: kothrudBranchAdminToken,
      body: {
        studentId: admit.data.studentId,
        amountInr: 10000,
        paymentMethod: 'BANK_TRANSFER',
        referenceNo: 'NEFT-TEST-01',
        paymentDate: '2026-10-29',
        idempotencyKey: 'idem-tanvi-installment-2',
      },
    });
    assert.equal(pay1.status, 201);

    const payReplay = await apiCall<{ id: number; deduplicated: boolean }>('/api/payments', {
      method: 'POST',
      token: kothrudBranchAdminToken,
      body: {
        studentId: admit.data.studentId,
        amountInr: 10000,
        paymentMethod: 'BANK_TRANSFER',
        referenceNo: 'NEFT-TEST-01',
        paymentDate: '2026-10-29',
        idempotencyKey: 'idem-tanvi-installment-2',
      },
    });
    assert.equal(payReplay.status, 200);
    assert.equal(payReplay.data.deduplicated, true);
    assert.equal(payReplay.data.id, pay1.data.id);

    // Reverse payment preserving historical record
    const rev = await apiCall(`/api/payments/${pay1.data.id}/reverse`, {
      method: 'POST',
      token: kothrudBranchAdminToken,
      body: { reason: 'Duplicate NEFT entry correction test' },
    });
    assert.equal(rev.status, 200);
  });

  await t.test('4. End-to-End Strict Teacher Verification Challenge (Single-Use Anti-Replay) & Checkout', async () => {
    const ch = await apiCall<{ id: number; issuedOneTimePlainCode: string }>(
      '/api/teacher-attendance/challenges',
      {
        method: 'POST',
        token: superAdminToken,
        body: {
          branchId: 2,
          validityMinutes: 15,
          applicableTeacherId: null,
          usagePolicy: 'SINGLE_USE_GLOBAL',
        },
      }
    );
    assert.equal(ch.status, 201);
    assert.equal(ch.data.issuedOneTimePlainCode.length, 6);

    // Check-in succeeds for Dr. Vikramaditya Nair (Branch 2)
    const checkIn = await apiCall('/api/teacher-attendance/check-in', {
      method: 'POST',
      token: vimanTeacherToken,
      body: { branchId: 2, code: ch.data.issuedOneTimePlainCode },
    });
    assert.equal(checkIn.status, 201);

    // Duplicate check-in on same day rejected
    const dupCheckIn = await apiCall('/api/teacher-attendance/check-in', {
      method: 'POST',
      token: vimanTeacherToken,
      body: { branchId: 2, code: ch.data.issuedOneTimePlainCode },
    });
    assert.equal(dupCheckIn.status, 409);

    // Checkout succeeds
    const checkOut = await apiCall('/api/teacher-attendance/check-out', {
      method: 'POST',
      token: vimanTeacherToken,
      body: {},
    });
    assert.equal(checkOut.status, 200);
  });

  await t.test('5. Daily Class Workflow: Schedule Session, Independent Campus Entry vs Classroom Attendance, Teaching Record & Syllabus Progress', async () => {
    // Schedule a conflict-free Physics session for Batch 1 on 2026-11-05
    const sched = await apiCall<{ id: number; sessionCode: string }>('/api/class-sessions', {
      method: 'POST',
      token: kothrudBranchAdminToken,
      body: {
        branchId: 1,
        batchId: 1,
        subjectId: 1,
        assignedTeacherId: 1,
        sessionDate: '2026-11-05',
        scheduledStart: '15:00',
        scheduledEnd: '17:00',
        classroom: 'Hall A-101',
      },
    });
    assert.equal(sched.status, 201);

    // Overlapping room/teacher schedule on same date & time must be rejected (409)
    const conflict = await apiCall('/api/class-sessions', {
      method: 'POST',
      token: kothrudBranchAdminToken,
      body: {
        branchId: 1,
        batchId: 1,
        subjectId: 1,
        assignedTeacherId: 1,
        sessionDate: '2026-11-05',
        scheduledStart: '16:00',
        scheduledEnd: '18:00',
        classroom: 'Hall A-101',
      },
    });
    assert.equal(conflict.status, 409);

    // Campus entry scan for Student #1 on 2026-11-05 MUST NOT auto-mark classroom session attendance
    const entryScan = await apiCall('/api/student-movements/entry', {
      method: 'POST',
      token: kothrudBranchAdminToken,
      body: {
        studentId: 1,
        branchId: 1,
        movementDate: '2026-11-05',
        entryTime: '14:45',
        recordingMethod: 'QR_BADGE',
      },
    });
    assert.equal(entryScan.status, 201);

    const rosterBefore = await apiCall<{ roster: Array<{ studentId: number; status: string }> }>(
      `/api/student-attendance/session/${sched.data.id}`,
      { token: kothrudBranchAdminToken }
    );
    assert.equal(rosterBefore.status, 200);
    const s1Before = rosterBefore.data.roster.find((r) => r.studentId === 1);
    assert.equal(s1Before?.status, 'NOT_RECORDED');

    // Explicitly mark classroom attendance
    const markAtt = await apiCall(`/api/student-attendance/session/${sched.data.id}`, {
      method: 'POST',
      token: kothrudBranchAdminToken,
      body: {
        entries: [{ studentId: 1, status: 'PRESENT', correctionReason: '' }],
      },
    });
    assert.equal(markAtt.status, 200);

    // Inspect pending topic in Batch 1 before teaching record submission
    const overviewBefore = await apiCall<{
      batches: Array<{
        id: number;
        syllabusProgress: { completedTopics: number };
        syllabusTopics: Array<{ topicId: number; status: string }>;
      }>;
    }>('/api/academics/overview?branchId=1', { token: kothrudBranchAdminToken });
    const batch1Before = overviewBefore.data.batches.find((b) => b.id === 1)!;
    const pendingTopic = batch1Before.syllabusTopics.find((tp) => tp.status !== 'COMPLETED')!;
    assert.ok(pendingTopic);

    // Submit daily teaching record completing that syllabus topic
    const teachRec = await apiCall('/api/teaching-records', {
      method: 'POST',
      token: kothrudBranchAdminToken,
      body: {
        classSessionId: sched.data.id,
        conductedByTeacherId: 1,
        actualStart: '15:02',
        actualEnd: '17:00',
        chapterCovered: 'Rotational Dynamics',
        topicsSummary: 'Completed Moment of Inertia & Parallel Axis Theorem derivations with JEE numericals.',
        coverageStatus: 'COMPLETED',
        topicUpdates: [{ topicId: pendingTopic.topicId, status: 'COMPLETED' }],
        homeworkAssigned: 'DPP-07 Q1-Q15',
      },
    });
    assert.equal(teachRec.status, 201);

    const overviewAfter = await apiCall<{
      batches: Array<{ id: number; syllabusProgress: { completedTopics: number } }>;
    }>('/api/academics/overview?branchId=1', { token: kothrudBranchAdminToken });
    const batch1After = overviewAfter.data.batches.find((b) => b.id === 1)!;
    assert.equal(batch1After.syllabusProgress.completedTopics, batch1Before.syllabusProgress.completedTopics + 1);
  });

  await t.test('6. Payroll Workflow: Draft Calculation -> Disbursement Gate -> Approval -> Disbursement & Teacher Own-Payslip Isolation', async () => {
    const calc = await apiCall<{ id: number }>('/api/payroll/calculate', {
      method: 'POST',
      token: superAdminToken,
      body: { branchId: 2, periodMonth: '2026-10', workingDays: 26 },
    });
    assert.equal(calc.status, 201);

    const payrollList = await apiCall<{
      mode: string;
      runs: Array<{ id: number; status: string; items: Array<{ id: number; teacherId: number }> }>;
    }>('/api/payroll?branchId=2', { token: superAdminToken });
    assert.equal(payrollList.data.mode, 'MANAGEMENT');
    const draftRun = payrollList.data.runs.find((r) => r.id === calc.data.id)!;
    assert.equal(draftRun.status, 'DRAFT');
    assert.ok(draftRun.items.length >= 1);

    // Attempting disbursement before run approval MUST fail (400)
    const prematureDisburse = await apiCall(`/api/payroll/items/${draftRun.items[0].id}/disburse`, {
      method: 'POST',
      token: superAdminToken,
      body: { disbursementRef: 'UTR-PREMATURE' },
    });
    assert.equal(prematureDisburse.status, 400);

    // Approve payroll run, then disburse item
    const approve = await apiCall(`/api/payroll/${calc.data.id}/approve`, {
      method: 'POST',
      token: superAdminToken,
      body: {},
    });
    assert.equal(approve.status, 200);

    const disburse = await apiCall(`/api/payroll/items/${draftRun.items[0].id}/disburse`, {
      method: 'POST',
      token: superAdminToken,
      body: { disbursementRef: 'UTR-202610-9988' },
    });
    assert.equal(disburse.status, 200);

    // Teacher querying /api/payroll receives OWN_ONLY mode with only their own payslips
    const teacherPayslips = await apiCall<{
      mode: string;
      runs: unknown[];
      myPayslips: Array<{ paymentStatus: string }>;
    }>('/api/payroll', { token: vimanTeacherToken });
    assert.equal(teacherPayslips.status, 200);
    assert.equal(teacherPayslips.data.mode, 'OWN_ONLY');
    assert.equal(teacherPayslips.data.runs.length, 0);
    assert.ok(teacherPayslips.data.myPayslips.length >= 1);
  });

  await t.test('7. Online Database Backup & Restoration Verification', async () => {
    const snap = await apiCall<{ ok: boolean; filename: string }>('/api/backups/create', {
      method: 'POST',
      token: superAdminToken,
      body: {},
    });
    assert.equal(snap.status, 201);
    createdBackupFilename = snap.data.filename;

    // Create a transient branch after the snapshot
    const tempBranch = await apiCall<{ id: number }>('/api/branches', {
      method: 'POST',
      token: superAdminToken,
      body: {
        code: 'TMP-BR-99',
        name: 'Transient Test Campus',
        city: 'Nashik',
        state: 'Maharashtra',
        address: 'College Road',
        phone: '+91-253-2200111',
        email: 'nashik@nikenacademy.edu.in',
      },
    });
    assert.equal(tempBranch.status, 201);

    // Restore from backup snapshot
    const restore = await apiCall('/api/backups/restore', {
      method: 'POST',
      token: superAdminToken,
      body: { filename: createdBackupFilename },
    });
    assert.equal(restore.status, 200);

    // Re-authenticate after database file swap and verify transient branch is absent
    const relogin = await apiCall<{ sessionToken: string }>('/api/auth/login', {
      method: 'POST',
      body: { email: 'director@nikenacademy.edu.in', password: DEV_SAMPLE_PASSWORD },
    });
    assert.equal(relogin.status, 200);

    const branchesAfter = await apiCall<{ branches: Array<{ code: string }> }>('/api/branches', {
      token: relogin.data.sessionToken,
    });
    assert.equal(branchesAfter.status, 200);
    assert.equal(
      branchesAfter.data.branches.some((b) => b.code === 'TMP-BR-99'),
      false
    );
  });

  await t.test('14. Dynamic faculty salary structure on onboarding & student fee structure declared on admission', async () => {
    const dirLogin = await apiCall<{ sessionToken: string }>('/api/auth/login', {
      method: 'POST',
      body: { email: 'director@nikenacademy.edu.in', password: DEV_SAMPLE_PASSWORD },
    });
    assert.equal(dirLogin.status, 200);
    const token = dirLogin.data.sessionToken;

    // 1. Onboard a faculty with custom salary structure entered directly during onboarding
    const newFaculty = await apiCall<{ teacherId: number; employeeCode: string; salaryStructureId: number }>('/api/teachers', {
      method: 'POST',
      token,
      body: {
        fullName: 'Prof. Ananya Sen',
        email: 'ananya.sen@nikenacademy.edu.in',
        phone: '+91-9823099901',
        designation: 'Senior Mathematics Professor',
        employmentType: 'FULL_TIME',
        joiningDate: '2026-07-01',
        primaryBranchId: 1,
        additionalBranchIds: [],
        subjectsCsv: 'Higher Mathematics, Calculus',
        // Personalized salary structure entered during onboarding
        salaryModel: 'FIXED_MONTHLY',
        baseSalaryInr: 80000,
        allowancesInr: 7500,
        statutoryDeductionInr: 2500,
        deductUnpaidLeave: true,
        documentsNotes: 'Masters in Mathematics from IISc',
      },
    });
    assert.equal(newFaculty.status, 201);
    assert.ok(newFaculty.data.salaryStructureId);

    // Verify faculty listing includes the personalized salary structure
    const teachersList = await apiCall<{
      teachers: Array<{
        id: number;
        fullName: string;
        salaryModel?: string;
        baseSalaryPaise?: number;
        allowancesPaise?: number;
      }>;
    }>('/api/teachers?branchId=1', { token });
    assert.equal(teachersList.status, 200);
    const sen = teachersList.data.teachers.find((t) => t.id === newFaculty.data.teacherId);
    assert.ok(sen);
    assert.equal(sen.salaryModel, 'FIXED_MONTHLY');
    assert.equal(sen.baseSalaryPaise, 8000000);
    assert.equal(sen.allowancesPaise, 750000);

    // 2. Admit a new student with declared fee structure (heads breakdown, installments & down payment)
    const newStudent = await apiCall<{ studentId: number; studentCode: string; receiptNumber: string }>('/api/students', {
      method: 'POST',
      token,
      body: {
        fullName: 'Kabir Verma',
        email: 'kabir.verma@student.nikenacademy.edu.in',
        phone: '+91-9821099902',
        academicLevel: 'Class 11 Science (IIT-JEE)',
        admissionDate: '2026-07-05',
        branchId: 1,
        guardianName: 'Sunil Verma',
        guardianPhone: '+91-9821099903',
        guardianRelation: 'Father',
        // Declared fee structure on admission
        admissionFeeInr: 10000,
        tuitionFeeInr: 40000,
        materialFeeInr: 5000,
        discountInr: 5000,
        discountReason: 'Early Admission Merit Scholarship',
        installmentsCount: 2,
        feeDueDate: '2026-07-05',
        initialPaymentInr: 15000,
        paymentMethod: 'UPI',
      },
    });
    assert.equal(newStudent.status, 201);
    assert.ok(newStudent.data.receiptNumber);

    // Verify student fee ledger has 2 installment assessments created and initial payment allocated
    const ledger = await apiCall<{
      assessments: Array<{ id: number; title: string; grossAmountPaise: number; allocatedPaidPaise: number; outstandingPaise: number }>;
      payments: Array<{ receiptNumber: string; amountPaise: number }>;
    }>(`/api/fees/ledger?branchId=1&studentId=${newStudent.data.studentId}`, { token });
    assert.equal(ledger.status, 200);

    // Net declared fee = 10k + 40k + 5k - 5k = 50k divided into 2 installments of 25k each
    assert.equal(ledger.data.assessments.length, 2);
    assert.equal(ledger.data.assessments[0].grossAmountPaise, 2500000);
    assert.equal(ledger.data.assessments[1].grossAmountPaise, 2500000);

    // 15k was paid upfront and allocated to the 1st installment
    assert.equal(ledger.data.assessments[0].allocatedPaidPaise, 1500000);
    assert.equal(ledger.data.assessments[0].outstandingPaise, 1000000);
    assert.equal(ledger.data.assessments[1].outstandingPaise, 2500000);
    assert.equal(ledger.data.payments.length, 1);
    assert.equal(ledger.data.payments[0].receiptNumber, newStudent.data.receiptNumber);
    assert.equal(ledger.data.payments[0].amountPaise, 1500000);
  });
});

