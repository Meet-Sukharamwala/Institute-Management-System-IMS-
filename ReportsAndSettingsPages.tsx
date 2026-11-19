import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { apiFetch, downloadAuthenticatedReport } from '../lib/api';
import { useAppContext } from '../context/AppContext';
import { Permission } from '../shared/types';
import {
  PageHeader,
  LoadingRows,
  ErrorBanner,
  StatusText,
} from '../components/UiPrimitives';

interface DailyTeachingReportRow {
  sessionCode: string;
  sessionDate: string;
  branchName: string;
  batchName: string;
  subjectName: string;
  teacherName: string;
  scheduledStart: string;
  scheduledEnd: string;
  sessionStatus: string;
  chapterCovered: string | null;
  topicsSummary: string | null;
  homeworkAssigned: string | null;
  nextLessonPlan: string | null;
}

export function ReportsPage() {
  const { selectedBranchId, hasPermission, notify } = useAppContext();
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10));

  const dailyQuery = useQuery({
    queryKey: ['report-daily-teaching', selectedBranchId, reportDate],
    queryFn: () =>
      apiFetch<{ date: string; rows: DailyTeachingReportRow[] }>(
        `/api/reports/daily-teaching?branchId=${encodeURIComponent(selectedBranchId)}&date=${encodeURIComponent(reportDate)}`
      ),
  });

  const handleExport = async (type: 'fee-collections' | 'student-attendance' | 'payroll-summary', format: 'csv' | 'excel') => {
    try {
      await downloadAuthenticatedReport(
        `/api/reports/export/${type}?branchId=${encodeURIComponent(selectedBranchId)}&format=${format}`,
        `ims-${type}-${reportDate}.${format === 'excel' ? 'xls.csv' : 'csv'}`
      );
      notify('success', `Exported ${type} (${format.toUpperCase()}) and logged in audit trail.`);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Export failed');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports, Academic Daily Summary & Audited Exports"
        subtitle="Role-restricted operational reports across attendance, academics, fees, and payroll with CSV, Excel-compatible, and Printable PDF views."
        actions={
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-xs font-semibold rounded-md no-print"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print / Save PDF</span>
          </button>
        }
      />

      {/* Export Cards */}
      {hasPermission(Permission.REPORT_EXPORT) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 no-print">
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Student Attendance Register</h2>
            <p className="text-xs text-slate-600">
              Complete session-wise classroom attendance, late arrivals, and correction history.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleExport('student-attendance', 'csv')}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded"
              >
                <Download className="w-3 h-3" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={() => void handleExport('student-attendance', 'excel')}
                className="px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded hover:bg-slate-50"
              >
                Excel Spreadsheet
              </button>
            </div>
          </div>

          {hasPermission(Permission.FEE_VIEW) && (
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <h2 className="text-sm font-bold text-slate-900">Fee Collections & Reversals</h2>
              <p className="text-xs text-slate-600">
                Receipt-level financial ledger export with payment mode and reversal status.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void handleExport('fee-collections', 'csv')}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded"
                >
                  <Download className="w-3 h-3" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleExport('fee-collections', 'excel')}
                  className="px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded hover:bg-slate-50"
                >
                  Excel Spreadsheet
                </button>
              </div>
            </div>
          )}

          {hasPermission(Permission.PAYROLL_CALCULATE, Permission.PAYROLL_APPROVE) && (
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <h2 className="text-sm font-bold text-slate-900">Faculty Payroll Register</h2>
              <p className="text-xs text-slate-600">
                Audited export of monthly gross earnings, statutory deductions, and net disbursements.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void handleExport('payroll-summary', 'csv')}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded"
                >
                  <Download className="w-3 h-3" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleExport('payroll-summary', 'excel')}
                  className="px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded hover:bg-slate-50"
                >
                  Excel Spreadsheet
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Daily Teaching Summary Report */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Daily Academic Teaching Report — What Was Taught & Planned Next
            </h2>
            <p className="text-xs text-slate-600">
              Answers who conducted each session, which batch attended, topics covered, homework assigned, and next class plan.
            </p>
          </div>
          <input
            type="date"
            aria-label="Daily teaching report date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            className="px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md no-print"
          />
        </div>

        {dailyQuery.isLoading ? (
          <LoadingRows />
        ) : dailyQuery.isError ? (
          <ErrorBanner message="Failed to load daily teaching report" onRetry={() => void dailyQuery.refetch()} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-4">Session & Batch</th>
                  <th className="py-2.5 px-4">Faculty</th>
                  <th className="py-2.5 px-4">Topics Taught</th>
                  <th className="py-2.5 px-4">Homework & Next Class</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {dailyQuery.data?.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      No scheduled classes on {reportDate}.
                    </td>
                  </tr>
                ) : (
                  dailyQuery.data?.rows.map((r) => (
                    <tr key={r.sessionCode}>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{r.batchName}</div>
                        <div className="font-mono text-slate-500">
                          {r.sessionCode} ({r.scheduledStart}–{r.scheduledEnd}) · {r.subjectName}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900">{r.teacherName}</td>
                      <td className="py-3 px-4">
                        {r.chapterCovered ? (
                          <>
                            <div className="font-semibold text-slate-900">{r.chapterCovered}</div>
                            <div className="text-slate-600">{r.topicsSummary}</div>
                          </>
                        ) : (
                          <span className="text-amber-700 font-medium">Pending faculty submission</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        <div>HW: {r.homeworkAssigned || '—'}</div>
                        <div>Next: {r.nextLessonPlan || '—'}</div>
                      </td>
                      <td className="py-3 px-4">
                        <StatusText status={r.sessionStatus} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export function SettingsPage() {
  const { user, hasPermission, refreshSession, notify } = useAppContext();
  const qc = useQueryClient();
  const [mfaPin, setMfaPin] = useState('246810');
  const [confirmRestoreFile, setConfirmRestoreFile] = useState<string | null>(null);

  const backupsQuery = useQuery({
    queryKey: ['db-backups'],
    enabled: hasPermission(Permission.BACKUP_MANAGE),
    queryFn: () =>
      apiFetch<{ backups: Array<{ filename: string; sizeBytes: number; createdAt: string }> }>(
        '/api/backups'
      ),
  });

  const handleToggleMfa = async (enabled: boolean) => {
    try {
      await apiFetch('/api/auth/mfa-toggle', {
        method: 'POST',
        body: { enabled, pin: mfaPin },
      });
      notify('success', enabled ? 'Privileged 6-digit MFA enabled.' : 'MFA disabled.');
      await refreshSession();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Could not update MFA setting');
    }
  };

  const handleRevokeOtherSessions = async () => {
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/revoke-all-sessions', {
        method: 'POST',
      });
      notify('success', res.message);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Could not revoke sessions');
    }
  };

  const handleCreateBackup = async () => {
    try {
      const res = await apiFetch<{ filename: string }>('/api/backups/create', {
        method: 'POST',
      });
      notify('success', `Consistent database backup snapshot created: ${res.filename}`);
      await qc.invalidateQueries({ queryKey: ['db-backups'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Backup failed');
    }
  };

  const handleRestoreBackup = async (filename: string) => {
    try {
      const res = await apiFetch<{ message: string }>('/api/backups/restore', {
        method: 'POST',
        body: { filename },
      });
      notify('success', res.message);
      setConfirmRestoreFile(null);
      await qc.invalidateQueries();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Restore failed');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Settings, Sessions & Database Backups"
        subtitle="Manage privileged multi-factor authentication, session revocation, and verified database backup/restoration."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <h2 className="text-base font-bold text-slate-900">Account Security & MFA</h2>
          <div className="text-xs text-slate-600 space-y-1">
            <div>
              <strong>Signed in as:</strong> {user?.fullName} ({user?.email})
            </div>
            <div>
              <strong>Role:</strong> {user?.roleName} · <strong>MFA Status:</strong>{' '}
              {user?.mfaEnabled ? 'Enabled' : 'Disabled'}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 space-y-3">
            <div>
              <label htmlFor="mfa-pin-input" className="block text-xs font-semibold text-slate-700 mb-1">
                Configure 6-Digit MFA Verification PIN
              </label>
              <input
                id="mfa-pin-input"
                type="text"
                maxLength={6}
                value={mfaPin}
                onChange={(e) => setMfaPin(e.target.value)}
                className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-md w-44"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleToggleMfa(!user?.mfaEnabled)}
                className="px-3.5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-md"
              >
                {user?.mfaEnabled ? 'Disable MFA' : 'Enable Privileged MFA'}
              </button>
              <button
                type="button"
                onClick={() => void handleRevokeOtherSessions()}
                className="px-3.5 py-2 border border-slate-300 text-xs font-semibold rounded-md hover:bg-slate-50"
              >
                Revoke All Other Sessions
              </button>
            </div>
          </div>
        </section>

        {hasPermission(Permission.BACKUP_MANAGE) && (
          <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Database Snapshots & Recovery</h2>
                <p className="text-xs text-slate-600">
                  Online hot-backup snapshots with verified one-click restoration.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleCreateBackup()}
                className="px-3.5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-md whitespace-nowrap"
              >
                Create Backup Snapshot
              </button>
            </div>

            <div className="divide-y divide-slate-200 border border-slate-200 rounded-md text-xs">
              {backupsQuery.data?.backups.length === 0 ? (
                <div className="p-4 text-slate-500 text-center">
                  No snapshots created yet. Click "Create Backup Snapshot" to test backup & restore.
                </div>
              ) : (
                backupsQuery.data?.backups.map((b) => (
                  <div key={b.filename} className="p-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-mono font-semibold text-slate-900">{b.filename}</div>
                      <div className="text-slate-500 tabular-nums">
                        {Math.round(b.sizeBytes / 1024)} KB · {b.createdAt.slice(0, 19).replace('T', ' ')}
                      </div>
                    </div>
                    {confirmRestoreFile === b.filename ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleRestoreBackup(b.filename)}
                          className="px-2.5 py-1 bg-red-700 text-white font-semibold rounded"
                        >
                          Confirm Restore
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRestoreFile(null)}
                          className="px-2 py-1 border border-slate-300 rounded"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRestoreFile(b.filename)}
                        className="px-2.5 py-1 border border-slate-300 rounded hover:bg-slate-50 font-medium"
                      >
                        Restore
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
