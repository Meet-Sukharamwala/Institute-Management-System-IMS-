import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { getDb } from './db';
import { ensureSeedData } from './seed';
import { authenticateMiddleware, csrfProtectionMiddleware } from './auth';
import { authAdminRouter } from './routes/auth-admin';
import { peopleRouter } from './routes/people';
import { academicsRouter } from './routes/academics';
import { attendanceRouter } from './routes/attendance';
import { financeRouter } from './routes/finance';
import { portalsReportsRouter } from './routes/portals-reports';

export function createApiApp(): express.Express {
  getDb();
  ensureSeedData();

  const app = express();
  app.disable('x-powered-by');

  // Security headers (CSP compatible with Vite + Google Fonts)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(authenticateMiddleware);
  app.use(csrfProtectionMiddleware);

  // OpenAPI 3.1 Specification endpoint
  app.get('/api/openapi.json', (_req, res) => {
    res.json({
      openapi: '3.1.0',
      info: {
        title: 'Institute Management System (IMS) REST API',
        version: '1.0.0',
        description:
          'Multi-branch educational operations API covering RBAC, Admissions, Syllabus Tracking, Verified Teacher Attendance, Fee Ledgers, Payroll, Examinations, and Portals.',
      },
      paths: {
        '/api/auth/login': { post: { summary: 'Authenticate user with password & optional MFA PIN' } },
        '/api/auth/me': { get: { summary: 'Retrieve active session & RBAC permissions' } },
        '/api/dashboard': { get: { summary: 'Branch & date-filtered operational statistics' } },
        '/api/branches': { get: { summary: 'List branches' }, post: { summary: 'Create branch' } },
        '/api/users': { get: { summary: 'List users & roles' }, post: { summary: 'Create staff/portal user' } },
        '/api/students': { get: { summary: 'Paginated student directory' }, post: { summary: 'Admit student with batch & fee ledger' } },
        '/api/teachers': { get: { summary: 'Faculty directory' }, post: { summary: 'Onboard faculty' } },
        '/api/academics/overview': { get: { summary: 'Courses, subjects, batches, syllabus progress, and timetable' } },
        '/api/class-sessions': { get: { summary: 'Scheduled class sessions' }, post: { summary: 'Schedule conflict-checked class session' } },
        '/api/teaching-records': { post: { summary: 'Submit or correct daily teaching record & syllabus progress' } },
        '/api/student-attendance/session/{sessionId}': { get: { summary: 'Session attendance roster' }, post: { summary: 'Record/override session attendance' } },
        '/api/student-movements/entry': { post: { summary: 'Record campus entry log (independent of classroom attendance)' } },
        '/api/teacher-attendance/challenges': { post: { summary: 'Host generates short-lived HMAC verification challenge' } },
        '/api/teacher-attendance/check-in': { post: { summary: 'Teacher completes verified check-in' } },
        '/api/fees/ledger': { get: { summary: 'Student fee ledger & posted receipts' } },
        '/api/payments': { post: { summary: 'Record idempotency-protected payment with FIFO obligation allocation' } },
        '/api/payments/{id}/reverse': { post: { summary: 'Controlled non-destructive payment reversal' } },
        '/api/payroll/calculate': { post: { summary: 'Calculate draft payroll from verified attendance & leave policy' } },
        '/api/examinations': { get: { summary: 'Examinations & results' }, post: { summary: 'Create examination' } },
        '/api/homework': { get: { summary: 'Homework & student submissions' }, post: { summary: 'Assign homework' } },
        '/api/portal/student': { get: { summary: 'Student self-service portal' } },
        '/api/portal/parent': { get: { summary: 'Guardian linked-children portal' } },
        '/api/reports/export/{reportType}': { get: { summary: 'Audited CSV / Excel-compatible report export' } },
        '/api/audit-logs': { get: { summary: 'Protected immutable audit trail' } },
        '/api/backups': { get: { summary: 'List database snapshots' } },
      },
    });
  });

  app.use('/api', authAdminRouter);
  app.use('/api', peopleRouter);
  app.use('/api', academicsRouter);
  app.use('/api', attendanceRouter);
  app.use('/api', financeRouter);
  app.use('/api', portalsReportsRouter);

  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Requested API endpoint does not exist.' });
  });

  // Centralized exception handler preventing internal stack trace leaks
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[IMS API Error]', err);
    res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected server error occurred while processing your request.',
    });
  });

  return app;
}
