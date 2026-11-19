import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAppContext } from '../context/AppContext';
import { Permission } from '../shared/types';
import {
  PageHeader,
  LoadingRows,
  ErrorBanner,
  EmptyState,
  StatusText,
} from '../components/UiPrimitives';

interface RosterEntry {
  studentId: number;
  studentCode: string;
  fullName: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'APPROVED_LEAVE' | 'NOT_RECORDED';
  previousStatus: string | null;
  correctionReason: string;
  hasApprovedLeave: number;
}

export function AttendancePage() {
  const { selectedBranchId, hasPermission, notify } = useAppContext();
  const qc = useQueryClient();
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [draftStatuses, setDraftStatuses] = useState<Record<number, 'PRESENT' | 'ABSENT' | 'LATE' | 'APPROVED_LEAVE'>>({});
  const [correctionReason, setCorrectionReason] = useState('');

  const sessionsQuery = useQuery({
    queryKey: ['att-sessions', selectedBranchId],
    queryFn: () =>
      apiFetch<{
        sessions: Array<{
          id: number;
          sessionCode: string;
          sessionDate: string;
          batchName: string;
          subjectName: string;
          scheduledStart: string;
        }>;
      }>(`/api/class-sessions?branchId=${encodeURIComponent(selectedBranchId)}`),
  });

  useEffect(() => {
    if (!selectedSessionId && sessionsQuery.data?.sessions[0]) {
      setSelectedSessionId(String(sessionsQuery.data.sessions[0].id));
    }
  }, [selectedSessionId, sessionsQuery.data]);

  const rosterQuery = useQuery({
    queryKey: ['session-roster', selectedSessionId],
    enabled: Boolean(selectedSessionId),
    queryFn: () =>
      apiFetch<{
        session: { id: number; sessionCode: string; batchName: string; subjectName: string; sessionDate: string };
        roster: RosterEntry[];
      }>(`/api/student-attendance/session/${selectedSessionId}`),
  });

  useEffect(() => {
    if (rosterQuery.data?.roster) {
      const next: Record<number, 'PRESENT' | 'ABSENT' | 'LATE' | 'APPROVED_LEAVE'> = {};
      for (const r of rosterQuery.data.roster) {
        if (r.status !== 'NOT_RECORDED') {
          next[r.studentId] = r.status;
        } else {
          next[r.studentId] = r.hasApprovedLeave ? 'APPROVED_LEAVE' : 'PRESENT';
        }
      }
      setDraftStatuses(next);
    }
  }, [rosterQuery.data]);

  const handleSaveAttendance = async () => {
    if (!selectedSessionId || !rosterQuery.data) return;
    const entries = rosterQuery.data.roster.map((r) => ({
      studentId: r.studentId,
      status: draftStatuses[r.studentId] || 'PRESENT',
      correctionReason,
    }));
    try {
      const res = await apiFetch<{ correctionsCount: number }>(
        `/api/student-attendance/session/${selectedSessionId}`,
        { method: 'POST', body: { entries } }
      );
      notify(
        'success',
        `Classroom attendance saved (${res.correctionsCount} audited correction(s)).`
      );
      setCorrectionReason('');
      await qc.invalidateQueries({ queryKey: ['session-roster', selectedSessionId] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Could not save attendance');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Classroom Session Attendance"
        subtitle="Record student attendance against scheduled academic sessions. Corrections preserve original values and require override authorization."
      />

      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
          <label htmlFor="att-session-select" className="text-xs font-semibold text-slate-700 whitespace-nowrap">
            Select Class Session:
          </label>
          <select
            id="att-session-select"
            value={selectedSessionId}
            onChange={(e) => setSelectedSessionId(e.target.value)}
            className="px-3 py-2 text-xs font-medium border border-slate-300 rounded-md w-full max-w-xl"
          >
            {sessionsQuery.data?.sessions.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.sessionDate} ({s.scheduledStart}) — {s.sessionCode}: {s.batchName} · {s.subjectName}
              </option>
            ))}
          </select>
        </div>

        {hasPermission(Permission.ATTENDANCE_STUDENT_OVERRIDE) && (
          <input
            type="text"
            value={correctionReason}
            onChange={(e) => setCorrectionReason(e.target.value)}
            placeholder="Mandatory reason if overriding recorded status..."
            aria-label="Attendance correction reason"
            className="px-3 py-2 text-xs border border-slate-300 rounded-md w-full sm:w-72"
          />
        )}
      </div>

      {rosterQuery.isLoading ? (
        <LoadingRows />
      ) : rosterQuery.isError ? (
        <ErrorBanner message="Failed to load session roster" onRetry={() => void rosterQuery.refetch()} />
      ) : !rosterQuery.data || rosterQuery.data.roster.length === 0 ? (
        <EmptyState
          title="No enrolled students in this batch session"
          description="Enrol students into the batch from the Students module to record classroom attendance."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Student ID</th>
                <th className="py-3 px-4">Student Name</th>
                <th className="py-3 px-4">Saved Status</th>
                <th className="py-3 px-4">Mark Attendance</th>
                <th className="py-3 px-4">Audit History</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rosterQuery.data.roster.map((r) => (
                <tr key={r.studentId} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900">
                    {r.studentCode}
                  </td>
                  <td className="py-3 px-4 font-medium text-slate-900">
                    {r.fullName}
                    {Boolean(r.hasApprovedLeave) && (
                      <span className="ml-2 text-xs text-amber-700">(Approved Leave on file)</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <StatusText status={r.status} />
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md w-fit">
                      {(['PRESENT', 'LATE', 'ABSENT', 'APPROVED_LEAVE'] as const).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() =>
                            setDraftStatuses((prev) => ({ ...prev, [r.studentId]: opt }))
                          }
                          className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                            draftStatuses[r.studentId] === opt
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {opt.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-500">
                    {r.previousStatus
                      ? `Corrected from ${r.previousStatus}: ${r.correctionReason}`
                      : 'Original'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {hasPermission(Permission.ATTENDANCE_STUDENT_MARK) && (
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => void handleSaveAttendance()}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md"
              >
                Save Session Attendance
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
