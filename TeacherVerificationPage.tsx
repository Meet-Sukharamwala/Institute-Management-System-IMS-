import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAppContext } from '../context/AppContext';
import { Permission, RoleCode } from '../shared/types';
import {
  PageHeader,
  LoadingRows,
  ErrorBanner,
  StatusText,
  ModalDialog,
} from '../components/UiPrimitives';

interface ChallengeRow {
  id: number;
  challengeUid: string;
  branchId: number;
  branchName: string;
  displayHint: string;
  applicableTeacherName: string | null;
  usagePolicy: string;
  expiresAtMs: number;
  isActive: number;
  isRevoked: number;
  consumptionCount: number;
  issuedByName: string;
}

interface TeacherAttRow {
  id: number;
  teacherId: number;
  employeeCode: string;
  teacherName: string;
  branchName: string;
  attendanceDate: string;
  checkInAt: string;
  checkOutAt: string | null;
  durationMinutes: number | null;
  verificationMethod: string;
  status: string;
  overrideReason: string;
}

export function TeacherVerificationPage() {
  const { user, branches, selectedBranchId, hasPermission, notify } = useAppContext();
  const qc = useQueryClient();
  const [dateFilter, setDateFilter] = useState(() => new Date().toISOString().slice(0, 10));

  const defaultBranch = selectedBranchId !== 'ALL' ? selectedBranchId : String(branches[0]?.id || 1);
  const [hostForm, setHostForm] = useState({
    branchId: defaultBranch,
    validityMinutes: '30',
    usagePolicy: 'ONE_TIME_PER_TEACHER' as 'ONE_TIME_PER_TEACHER' | 'SINGLE_USE_GLOBAL',
  });
  const [issuedCodeBanner, setIssuedCodeBanner] = useState<{
    uid: string;
    code: string;
    expiresAtMs: number;
  } | null>(null);

  const [checkInBranchId, setCheckInBranchId] = useState(defaultBranch);
  const [checkInCode, setCheckInCode] = useState('');

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideForm, setOverrideForm] = useState({
    teacherId: '',
    branchId: defaultBranch,
    attendanceDate: dateFilter,
    checkInAt: '08:30',
    checkOutAt: '16:30',
    durationMinutes: '480',
    overrideReason: '',
  });

  const isHost = hasPermission(Permission.TEACHER_VERIFICATION_HOST);
  const isTeacher = hasPermission(Permission.TEACHER_VERIFICATION_CHECKIN) && Boolean(user?.teacherId);
  const canAdminOverride =
    user?.roleCode === RoleCode.SUPER_ADMIN || user?.roleCode === RoleCode.BRANCH_ADMIN;

  const query = useQuery({
    queryKey: ['teacher-verification', selectedBranchId, dateFilter],
    queryFn: () =>
      apiFetch<{
        serverTimeIso: string;
        serverNowMs: number;
        challenges: ChallengeRow[];
        records: TeacherAttRow[];
        failedAttempts: Array<{
          id: number;
          teacherName: string;
          branchName: string;
          failureReason: string;
          attemptedAt: string;
        }>;
      }>(
        `/api/teacher-attendance?branchId=${encodeURIComponent(selectedBranchId)}&date=${encodeURIComponent(dateFilter)}`
      ),
  });

  const teachersLookup = useQuery({
    queryKey: ['teachers-override-lookup', overrideForm.branchId],
    enabled: overrideOpen && canAdminOverride,
    queryFn: () =>
      apiFetch<{ teachers: Array<{ id: number; fullName: string; employeeCode: string }> }>(
        `/api/teachers?branchId=${encodeURIComponent(overrideForm.branchId)}`
      ),
  });

  const handleIssueChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{
        challengeUid: string;
        issuedOneTimePlainCode: string;
        expiresAtMs: number;
      }>('/api/teacher-attendance/challenges', {
        method: 'POST',
        body: {
          branchId: Number(hostForm.branchId),
          validityMinutes: Number(hostForm.validityMinutes),
          applicableTeacherId: null,
          usagePolicy: hostForm.usagePolicy,
        },
      });
      setIssuedCodeBanner({
        uid: res.challengeUid,
        code: res.issuedOneTimePlainCode,
        expiresAtMs: res.expiresAtMs,
      });
      notify('success', `Verification challenge ${res.challengeUid} issued.`);
      await qc.invalidateQueries({ queryKey: ['teacher-verification'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Could not issue challenge');
    }
  };

  const handleRevoke = async (id: number) => {
    try {
      await apiFetch(`/api/teacher-attendance/challenges/${id}/revoke`, { method: 'POST' });
      notify('info', 'Verification challenge revoked immediately.');
      await qc.invalidateQueries({ queryKey: ['teacher-verification'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Revocation failed');
    }
  };

  const handleTeacherCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ message: string }>('/api/teacher-attendance/check-in', {
        method: 'POST',
        body: { branchId: Number(checkInBranchId), code: checkInCode },
      });
      notify('success', res.message);
      setCheckInCode('');
      await qc.invalidateQueries({ queryKey: ['teacher-verification'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Check-in rejected');
    }
  };

  const handleTeacherCheckOut = async () => {
    try {
      const res = await apiFetch<{ checkOutAt: string; durationMinutes: number }>(
        '/api/teacher-attendance/check-out',
        { method: 'POST' }
      );
      notify(
        'success',
        `Checked out at ${res.checkOutAt} (${res.durationMinutes} minutes verified).`
      );
      await qc.invalidateQueries({ queryKey: ['teacher-verification'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Checkout failed');
    }
  };

  const handleAdminOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/teacher-attendance/override', {
        method: 'POST',
        body: {
          teacherId: Number(overrideForm.teacherId),
          branchId: Number(overrideForm.branchId),
          attendanceDate: overrideForm.attendanceDate,
          checkInAt: overrideForm.checkInAt,
          checkOutAt: overrideForm.checkOutAt,
          durationMinutes: Number(overrideForm.durationMinutes),
          overrideReason: overrideForm.overrideReason,
        },
      });
      notify('success', 'Audited manual attendance override recorded.');
      setOverrideOpen(false);
      await qc.invalidateQueries({ queryKey: ['teacher-verification'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Override failed');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Strict Teacher Attendance Verification"
        subtitle="Host-controlled, short-lived cryptographic challenges with server-side timestamps, anti-replay enforcement, and separate checkout."
        actions={
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Attendance review date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
            />
            {canAdminOverride && (
              <button
                type="button"
                onClick={() => setOverrideOpen(true)}
                className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-xs font-semibold rounded-md whitespace-nowrap"
              >
                Admin Exception Override
              </button>
            )}
          </div>
        }
      />

      {/* Teacher Self Check-In / Checkout Panel */}
      {isTeacher && (
        <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Faculty Verified Check-In & Checkout</h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Enter the active branch challenge code displayed by the campus host. Timestamps use the authoritative server clock.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleTeacherCheckOut()}
              className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-xs font-semibold rounded-md whitespace-nowrap"
            >
              Complete Daily Checkout
            </button>
          </div>

          <form onSubmit={handleTeacherCheckIn} className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <select
              aria-label="Campus branch for check-in"
              value={checkInBranchId}
              onChange={(e) => setCheckInBranchId(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-300 rounded-md"
            >
              {branches.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              required
              value={checkInCode}
              onChange={(e) => setCheckInCode(e.target.value.toUpperCase())}
              placeholder="Enter 6-character challenge code (e.g., SKP742)"
              aria-label="Verification challenge code"
              className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md"
            >
              Verify Challenge & Check In
            </button>
          </form>
        </section>
      )}

      {/* Host Challenge Issuance Console */}
      {isHost && (
        <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Host Verification Desk — Generate Daily Challenge</h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Plaintext verification codes are displayed once upon generation and stored solely as salted HMAC-SHA256 digests. Note: A shared code verifies campus desk interaction; architecture supports on-site QR/kiosk hardware without covert device tracking.
            </p>
          </div>

          <form onSubmit={handleIssueChallenge} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div>
              <label htmlFor="host-branch" className="block text-xs font-semibold text-slate-700 mb-1">
                Campus Branch
              </label>
              <select
                id="host-branch"
                value={hostForm.branchId}
                onChange={(e) => setHostForm({ ...hostForm, branchId: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
              >
                {branches.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="host-validity" className="block text-xs font-semibold text-slate-700 mb-1">
                Validity Window (Mins)
              </label>
              <input
                id="host-validity"
                type="number"
                min={2}
                max={720}
                value={hostForm.validityMinutes}
                onChange={(e) => setHostForm({ ...hostForm, validityMinutes: e.target.value })}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="host-policy" className="block text-xs font-semibold text-slate-700 mb-1">
                Consumption Policy
              </label>
              <select
                id="host-policy"
                value={hostForm.usagePolicy}
                onChange={(e) =>
                  setHostForm({
                    ...hostForm,
                    usagePolicy: e.target.value as 'ONE_TIME_PER_TEACHER' | 'SINGLE_USE_GLOBAL',
                  })
                }
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
              >
                <option value="ONE_TIME_PER_TEACHER">One-Time Per Eligible Faculty</option>
                <option value="SINGLE_USE_GLOBAL">Strict Single-Use Global Code</option>
              </select>
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md whitespace-nowrap"
            >
              Generate New Challenge
            </button>
          </form>

          {issuedCodeBanner && (
            <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-emerald-950">
                  Active One-Time Display Code ({issuedCodeBanner.uid}) — Copy or show at Reception Kiosk now:
                </div>
                <div className="text-2xl font-mono font-bold tracking-widest text-emerald-900 mt-1">
                  {issuedCodeBanner.code}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIssuedCodeBanner(null)}
                className="px-3 py-1.5 text-xs bg-white border border-emerald-300 rounded-md text-emerald-900 self-start sm:self-center"
              >
                Hide Code
              </button>
            </div>
          )}
        </section>
      )}

      {query.isLoading ? (
        <LoadingRows />
      ) : query.isError ? (
        <ErrorBanner message="Failed to load teacher verification records" onRetry={() => void query.refetch()} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Verified Attendance Log */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <div className="px-4 py-3 border-b border-slate-200 font-bold text-sm text-slate-900">
              Verified Faculty Check-In & Checkout Log ({dateFilter})
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Faculty</th>
                  <th className="py-2.5 px-4">In / Out</th>
                  <th className="py-2.5 px-4 text-right">Duration</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {query.data?.records.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500">
                      No faculty check-ins recorded on {dateFilter}.
                    </td>
                  </tr>
                ) : (
                  query.data?.records.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900">{r.teacherName}</div>
                        <div className="text-slate-500">{r.branchName}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums">
                        {r.checkInAt} → {r.checkOutAt || 'Active'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {r.durationMinutes ? `${r.durationMinutes} min` : '—'}
                      </td>
                      <td className="py-2.5 px-4">
                        <StatusText status={r.status} />
                        {r.overrideReason && (
                          <div className="text-slate-500 mt-0.5">{r.overrideReason}</div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Issued Challenges & Failed Attempts */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
              <div className="px-4 py-3 border-b border-slate-200 font-bold text-sm text-slate-900">
                Issued Verification Challenges
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                    <th className="py-2.5 px-3">UID & Hint</th>
                    <th className="py-2.5 px-3">Used</th>
                    <th className="py-2.5 px-3">State</th>
                    {isHost && <th className="py-2.5 px-3 text-right">Control</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {query.data?.challenges.map((c) => {
                    const expired = (query.data?.serverNowMs || Date.now()) > c.expiresAtMs;
                    const stateLabel = c.isRevoked
                      ? 'REVOKED'
                      : expired || !c.isActive
                        ? 'EXPIRED'
                        : 'ACTIVE';
                    return (
                      <tr key={c.id}>
                        <td className="py-2.5 px-3">
                          <div className="font-mono font-semibold text-slate-900">{c.challengeUid}</div>
                          <div className="text-slate-500 font-mono">{c.displayHint}</div>
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums">{c.consumptionCount}</td>
                        <td className="py-2.5 px-3">
                          <StatusText status={stateLabel} />
                        </td>
                        {isHost && (
                          <td className="py-2.5 px-3 text-right">
                            {stateLabel === 'ACTIVE' && (
                              <button
                                type="button"
                                onClick={() => void handleRevoke(c.id)}
                                className="px-2 py-1 text-red-700 border border-red-200 rounded hover:bg-red-50"
                              >
                                Revoke
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {isHost && query.data && query.data.failedAttempts.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <h3 className="text-xs font-bold text-slate-900 mb-2">Recent Rejected Verification Attempts</h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {query.data.failedAttempts.slice(0, 5).map((f) => (
                    <div key={f.id} className="py-2">
                      <span className="font-semibold text-slate-900">{f.teacherName}</span>:{' '}
                      <span className="text-red-700">{f.failureReason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Admin Manual Override Modal */}
      <ModalDialog
        open={overrideOpen}
        title="Authorized Teacher Attendance Exception Override"
        onClose={() => setOverrideOpen(false)}
      >
        <form onSubmit={handleAdminOverride} className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Faculty Member</label>
            <select
              required
              value={overrideForm.teacherId}
              onChange={(e) => setOverrideForm({ ...overrideForm, teacherId: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            >
              <option value="">Select Faculty</option>
              {teachersLookup.data?.teachers.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.employeeCode} — {t.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Check-In</label>
              <input
                type="time"
                required
                value={overrideForm.checkInAt}
                onChange={(e) => setOverrideForm({ ...overrideForm, checkInAt: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Checkout</label>
              <input
                type="time"
                required
                value={overrideForm.checkOutAt}
                onChange={(e) => setOverrideForm({ ...overrideForm, checkOutAt: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Duration (Min)</label>
              <input
                type="number"
                required
                value={overrideForm.durationMinutes}
                onChange={(e) => setOverrideForm({ ...overrideForm, durationMinutes: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Mandatory Audit Reason</label>
            <input
              type="text"
              required
              minLength={5}
              placeholder="e.g., Power outage at reception kiosk verified by Campus Head"
              value={overrideForm.overrideReason}
              onChange={(e) => setOverrideForm({ ...overrideForm, overrideReason: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOverrideOpen(false)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Record Audited Override
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
