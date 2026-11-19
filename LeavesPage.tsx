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

interface LeaveRow {
  id: number;
  applicantType: 'TEACHER' | 'STUDENT';
  teacherName: string | null;
  studentName: string | null;
  branchName: string;
  leaveType: string;
  isPaid: number;
  startDate: string;
  endDate: string;
  daysCount: number;
  reason: string;
  status: string;
  reviewRemarks: string;
}

interface HolidayRow {
  id: number;
  branchName: string | null;
  holidayDate: string;
  title: string;
  description: string;
}

export function LeavesPage() {
  const { user, selectedBranchId, hasPermission, notify } = useAppContext();
  const qc = useQueryClient();
  const [applyOpen, setApplyOpen] = useState(false);
  const [holidayOpen, setHolidayOpen] = useState(false);

  const [leaveForm, setLeaveForm] = useState({
    applicantType: (user?.roleCode === RoleCode.STUDENT ? 'STUDENT' : 'TEACHER') as 'TEACHER' | 'STUDENT',
    leaveType: 'CASUAL' as 'CASUAL' | 'MEDICAL' | 'UNPAID' | 'ACADEMIC',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    daysCount: '1',
    reason: '',
  });

  const [holidayForm, setHolidayForm] = useState({
    holidayDate: '2026-12-25',
    title: '',
    description: '',
  });

  const query = useQuery({
    queryKey: ['leaves-holidays', selectedBranchId],
    queryFn: () =>
      apiFetch<{ leaves: LeaveRow[]; holidays: HolidayRow[] }>(
        `/api/leave-requests?branchId=${encodeURIComponent(selectedBranchId)}`
      ),
  });

  const handleApplyLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/leave-requests', {
        method: 'POST',
        body: {
          ...leaveForm,
          daysCount: Number(leaveForm.daysCount),
        },
      });
      notify('success', 'Leave application submitted for review.');
      setApplyOpen(false);
      await qc.invalidateQueries({ queryKey: ['leaves-holidays'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Could not submit leave request');
    }
  };

  const handleReviewLeave = async (id: number, status: 'APPROVED' | 'REJECTED') => {
    try {
      await apiFetch(`/api/leave-requests/${id}/review`, {
        method: 'PATCH',
        body: { status, reviewRemarks: `${status} via Leave Management console` },
      });
      notify('success', `Leave request ${status.toLowerCase()}.`);
      await qc.invalidateQueries({ queryKey: ['leaves-holidays'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Review failed');
    }
  };

  const handleCreateHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/holidays', {
        method: 'POST',
        body: {
          branchId: selectedBranchId === 'ALL' ? null : Number(selectedBranchId),
          ...holidayForm,
        },
      });
      notify('success', 'Academic holiday published to calendar.');
      setHolidayOpen(false);
      await qc.invalidateQueries({ queryKey: ['leaves-holidays'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to declare holiday');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Applications & Academic Holiday Calendar"
        subtitle="Policy-integrated leave approvals for faculty and students alongside campus holiday declarations."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setApplyOpen(true)}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md whitespace-nowrap"
            >
              Submit Leave Request
            </button>
            {hasPermission(Permission.LEAVE_APPROVE) && (
              <button
                type="button"
                onClick={() => setHolidayOpen(true)}
                className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-xs font-semibold rounded-md whitespace-nowrap"
              >
                Declare Holiday
              </button>
            )}
          </div>
        }
      />

      {query.isLoading ? (
        <LoadingRows />
      ) : query.isError ? (
        <ErrorBanner message="Failed to load leave calendar" onRetry={() => void query.refetch()} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <div className="px-4 py-3 border-b border-slate-200 font-bold text-sm text-slate-900">
              Leave Applications
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Applicant</th>
                  <th className="py-2.5 px-4">Dates & Days</th>
                  <th className="py-2.5 px-4">Type & Reason</th>
                  <th className="py-2.5 px-4">Status</th>
                  {hasPermission(Permission.LEAVE_APPROVE) && (
                    <th className="py-2.5 px-4 text-right">Decision</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {query.data?.leaves.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900">
                        {l.teacherName || l.studentName || l.applicantType}
                      </div>
                      <div className="text-slate-500">
                        {l.applicantType} · {l.branchName}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums">
                      <div>
                        {l.startDate} → {l.endDate}
                      </div>
                      <div className="text-slate-500">{l.daysCount} day(s)</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">
                        {l.leaveType} ({l.isPaid ? 'Paid' : 'Unpaid'})
                      </div>
                      <div className="text-slate-600">{l.reason}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusText status={l.status} />
                    </td>
                    {hasPermission(Permission.LEAVE_APPROVE) && (
                      <td className="py-2.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                        {l.status === 'PENDING' && (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleReviewLeave(l.id, 'APPROVED')}
                              className="px-2.5 py-1 bg-emerald-800 text-white font-semibold rounded"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleReviewLeave(l.id, 'REJECTED')}
                              className="px-2.5 py-1 border border-red-300 text-red-700 font-semibold rounded"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Declared Academic Holidays</h2>
            <div className="divide-y divide-slate-100 text-xs">
              {query.data?.holidays.map((h) => (
                <div key={h.id} className="py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{h.title}</span>
                    <span className="font-mono text-slate-600">{h.holidayDate}</span>
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    {h.branchName || 'All Branches'} {h.description ? `· ${h.description}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Submit Leave Modal */}
      <ModalDialog open={applyOpen} title="Submit Leave Request" onClose={() => setApplyOpen(false)}>
        <form onSubmit={handleApplyLeave} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Leave Category</label>
              <select
                value={leaveForm.leaveType}
                onChange={(e) =>
                  setLeaveForm({
                    ...leaveForm,
                    leaveType: e.target.value as 'CASUAL' | 'MEDICAL' | 'UNPAID' | 'ACADEMIC',
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              >
                <option value="CASUAL">Casual Leave</option>
                <option value="MEDICAL">Medical Leave</option>
                <option value="ACADEMIC">Academic / Olympiad Leave</option>
                <option value="UNPAID">Unpaid Leave</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Total Days</label>
              <input
                type="number"
                min={1}
                max={30}
                value={leaveForm.daysCount}
                onChange={(e) => setLeaveForm({ ...leaveForm, daysCount: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Start Date</label>
              <input
                type="date"
                required
                value={leaveForm.startDate}
                onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">End Date</label>
              <input
                type="date"
                required
                value={leaveForm.endDate}
                onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Reason</label>
            <textarea
              required
              rows={2}
              value={leaveForm.reason}
              onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setApplyOpen(false)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Submit Request
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Declare Holiday Modal */}
      <ModalDialog open={holidayOpen} title="Declare Academic Holiday" onClose={() => setHolidayOpen(false)}>
        <form onSubmit={handleCreateHoliday} className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Holiday Date</label>
            <input
              type="date"
              required
              value={holidayForm.holidayDate}
              onChange={(e) => setHolidayForm({ ...holidayForm, holidayDate: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Holiday Title</label>
            <input
              type="text"
              required
              value={holidayForm.title}
              onChange={(e) => setHolidayForm({ ...holidayForm, title: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Announcement Note</label>
            <input
              type="text"
              value={holidayForm.description}
              onChange={(e) => setHolidayForm({ ...holidayForm, description: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setHolidayOpen(false)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Publish Holiday
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
