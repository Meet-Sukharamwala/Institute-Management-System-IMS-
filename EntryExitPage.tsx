import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAppContext } from '../context/AppContext';
import {
  PageHeader,
  LoadingRows,
  ErrorBanner,
  EmptyState,
  StatusText,
  ModalDialog,
} from '../components/UiPrimitives';

interface MovementRow {
  id: number;
  studentId: number;
  studentCode: string;
  studentName: string;
  branchId: number;
  branchName: string;
  movementDate: string;
  entryTime: string;
  exitTime: string | null;
  recordingMethod: string;
  operatorName: string;
  exceptionFlag: number;
  exceptionReason: string;
}

export function EntryExitPage() {
  const { branches, selectedBranchId, notify } = useAppContext();
  const qc = useQueryClient();
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [entryModal, setEntryModal] = useState(false);
  const [exitTarget, setExitTarget] = useState<MovementRow | null>(null);
  const [exitTime, setExitTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [exitNote, setExitNote] = useState('');

  const defaultBranch = selectedBranchId !== 'ALL' ? selectedBranchId : String(branches[0]?.id || 1);
  const [entryForm, setEntryForm] = useState({
    studentId: '',
    branchId: defaultBranch,
    movementDate: new Date().toISOString().slice(0, 10),
    entryTime: new Date().toTimeString().slice(0, 5),
    recordingMethod: 'STAFF_DESK' as 'STAFF_DESK' | 'QR_BADGE' | 'RFID_GATE',
  });

  const movementsQuery = useQuery({
    queryKey: ['student-movements', selectedBranchId, exceptionsOnly],
    queryFn: () =>
      apiFetch<{ movements: MovementRow[] }>(
        `/api/student-movements?branchId=${encodeURIComponent(selectedBranchId)}&exceptionsOnly=${exceptionsOnly}`
      ),
  });

  const studentsLookup = useQuery({
    queryKey: ['students-entry-lookup', entryForm.branchId],
    enabled: entryModal,
    queryFn: () =>
      apiFetch<{ students: Array<{ id: number; studentCode: string; fullName: string }> }>(
        `/api/students?branchId=${encodeURIComponent(entryForm.branchId)}&pageSize=100`
      ),
  });

  const handleLogEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/student-movements/entry', {
        method: 'POST',
        body: {
          ...entryForm,
          studentId: Number(entryForm.studentId),
          branchId: Number(entryForm.branchId),
        },
      });
      notify('success', 'Campus entry logged (independent of classroom attendance).');
      setEntryModal(false);
      await qc.invalidateQueries({ queryKey: ['student-movements'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to log campus entry');
    }
  };

  const handleRecordExit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exitTarget) return;
    try {
      await apiFetch(`/api/student-movements/${exitTarget.id}/exit`, {
        method: 'PATCH',
        body: { exitTime, exceptionReason: exitNote },
      });
      notify('success', `Recorded campus exit for ${exitTarget.studentName}.`);
      setExitTarget(null);
      setExitNote('');
      await qc.invalidateQueries({ queryKey: ['student-movements'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Could not record exit');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campus Student Entry & Exit Gate Log"
        subtitle="Separate physical campus movement tracking. Entry scans never automatically mark classroom lecture attendance."
        actions={
          <button
            type="button"
            onClick={() => setEntryModal(true)}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md whitespace-nowrap"
          >
            Record Campus Entry
          </button>
        }
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setExceptionsOnly((v) => !v)}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-md border ${
            exceptionsOnly
              ? 'bg-amber-900 text-white border-amber-900'
              : 'bg-white text-slate-700 border-slate-300'
          }`}
        >
          {exceptionsOnly ? 'Showing Missing-Exit Exceptions Only' : 'Filter Missing-Exit Exceptions'}
        </button>
      </div>

      {movementsQuery.isLoading ? (
        <LoadingRows />
      ) : movementsQuery.isError ? (
        <ErrorBanner message="Failed to load campus movements" onRetry={() => void movementsQuery.refetch()} />
      ) : movementsQuery.data?.movements.length === 0 ? (
        <EmptyState
          title="No campus movement records"
          description="Record student arrival and departure times at the reception desk or badge scanner."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Campus</th>
                <th className="py-3 px-4">Entry Time</th>
                <th className="py-3 px-4">Exit Time</th>
                <th className="py-3 px-4">Method & Operator</th>
                <th className="py-3 px-4">Exception Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {movementsQuery.data?.movements.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs tabular-nums">{m.movementDate}</td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">{m.studentName}</div>
                    <div className="font-mono text-xs text-slate-500">{m.studentCode}</div>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600">{m.branchName}</td>
                  <td className="py-3 px-4 font-mono text-xs tabular-nums font-semibold text-slate-900">
                    {m.entryTime}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs tabular-nums">
                    {m.exitTime || <span className="text-amber-700 font-semibold">Still On Campus</span>}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    {m.recordingMethod.replace('_', ' ')} · {m.operatorName}
                  </td>
                  <td className="py-3 px-4 text-xs">
                    {!m.exitTime || m.exceptionFlag ? (
                      <div>
                        <StatusText status="PENDING" />
                        {m.exceptionReason && (
                          <div className="text-amber-800 mt-0.5">{m.exceptionReason}</div>
                        )}
                      </div>
                    ) : (
                      <StatusText status="COMPLETED" />
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {!m.exitTime && (
                      <button
                        type="button"
                        onClick={() => {
                          setExitTarget(m);
                          setExitTime(new Date().toTimeString().slice(0, 5));
                        }}
                        className="px-3 py-1 bg-slate-900 text-white text-xs font-semibold rounded"
                      >
                        Log Exit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Entry Modal */}
      <ModalDialog open={entryModal} title="Record Student Campus Entry" onClose={() => setEntryModal(false)}>
        <form onSubmit={handleLogEntry} className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Campus Branch</label>
            <select
              value={entryForm.branchId}
              onChange={(e) => setEntryForm({ ...entryForm, branchId: e.target.value, studentId: '' })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            >
              {branches.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Student</label>
            <select
              required
              value={entryForm.studentId}
              onChange={(e) => setEntryForm({ ...entryForm, studentId: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            >
              <option value="">Select Student</option>
              {studentsLookup.data?.students.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.studentCode} — {s.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
              <input
                type="date"
                required
                value={entryForm.movementDate}
                onChange={(e) => setEntryForm({ ...entryForm, movementDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Entry Time</label>
              <input
                type="time"
                required
                value={entryForm.entryTime}
                onChange={(e) => setEntryForm({ ...entryForm, entryTime: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Capture Method</label>
              <select
                value={entryForm.recordingMethod}
                onChange={(e) =>
                  setEntryForm({
                    ...entryForm,
                    recordingMethod: e.target.value as 'STAFF_DESK' | 'QR_BADGE' | 'RFID_GATE',
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              >
                <option value="STAFF_DESK">Staff Desk Register</option>
                <option value="QR_BADGE">QR ID Badge Adapter</option>
                <option value="RFID_GATE">RFID Gate Adapter</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setEntryModal(false)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Record Entry
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Exit Modal */}
      <ModalDialog
        open={Boolean(exitTarget)}
        title={`Record Campus Exit — ${exitTarget?.studentName || ''}`}
        onClose={() => setExitTarget(null)}
      >
        <form onSubmit={handleRecordExit} className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Departure Time</label>
            <input
              type="time"
              required
              value={exitTime}
              onChange={(e) => setExitTime(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Resolution / Gate Remarks (Optional)</label>
            <input
              type="text"
              value={exitNote}
              onChange={(e) => setExitNote(e.target.value)}
              placeholder="e.g., Stayed back for library self-study"
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setExitTarget(null)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Confirm Exit
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
