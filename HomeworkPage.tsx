import React, { useState } from 'react';
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
  ModalDialog,
} from '../components/UiPrimitives';

interface HomeworkRow {
  id: number;
  batchName: string;
  subjectName: string;
  teacherName: string;
  chapterName: string;
  title: string;
  instructions: string;
  dueDate: string;
  submissions: Array<{
    id: number;
    studentId: number;
    studentCode: string;
    studentName: string;
    status: string;
    effectiveStatus: string;
    teacherFeedback: string;
  }>;
}

export function HomeworkPage() {
  const { branches, selectedBranchId, hasPermission, notify } = useAppContext();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

  const defaultBranch = selectedBranchId !== 'ALL' ? selectedBranchId : String(branches[0]?.id || 1);
  const [form, setForm] = useState({
    branchId: defaultBranch,
    batchId: '',
    subjectId: '',
    chapterName: '',
    title: '',
    instructions: '',
    dueDate: new Date().toISOString().slice(0, 10),
  });

  const query = useQuery({
    queryKey: ['homework', selectedBranchId],
    queryFn: () =>
      apiFetch<{ homework: HomeworkRow[] }>(
        `/api/homework?branchId=${encodeURIComponent(selectedBranchId)}`
      ),
  });

  const acadLookup = useQuery({
    queryKey: ['hw-acad-lookup', form.branchId],
    enabled: modalOpen,
    queryFn: () =>
      apiFetch<{
        courses: Array<{ subjects: Array<{ id: number; code: string; name: string }> }>;
        batches: Array<{ id: number; code: string; name: string }>;
      }>(`/api/academics/overview?branchId=${encodeURIComponent(form.branchId)}`),
  });

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/homework', {
        method: 'POST',
        body: {
          branchId: Number(form.branchId),
          batchId: Number(form.batchId),
          subjectId: Number(form.subjectId),
          chapterName: form.chapterName,
          title: form.title,
          instructions: form.instructions,
          dueDate: form.dueDate,
        },
      });
      notify('success', 'Homework assigned to all active students in batch.');
      setModalOpen(false);
      await qc.invalidateQueries({ queryKey: ['homework'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to assign homework');
    }
  };

  const handleReviewSubmission = async (subId: number, status: 'PENDING' | 'SUBMITTED' | 'REVIEWED') => {
    try {
      await apiFetch(`/api/homework-submissions/${subId}`, {
        method: 'PATCH',
        body: { status, teacherFeedback: status === 'REVIEWED' ? 'Checked in class' : '' },
      });
      notify('success', 'Homework submission status updated.');
      await qc.invalidateQueries({ queryKey: ['homework'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Update failed');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Homework Assignments & Completion Tracking"
        subtitle="Assign chapter problem sets to batches, track student completion, and identify overdue assignments."
        actions={
          hasPermission(Permission.HOMEWORK_MANAGE) ? (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md whitespace-nowrap"
            >
              Assign Homework
            </button>
          ) : undefined
        }
      />

      {query.isLoading ? (
        <LoadingRows />
      ) : query.isError ? (
        <ErrorBanner message="Failed to load homework" onRetry={() => void query.refetch()} />
      ) : query.data?.homework.length === 0 ? (
        <EmptyState title="No homework assignments found" description="Assign practice problems to an active batch." />
      ) : (
        <div className="space-y-5">
          {query.data?.homework.map((hw) => (
            <div key={hw.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="p-5 border-b border-slate-200 bg-slate-50">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-slate-900">{hw.title}</h2>
                  <span className="font-mono text-xs text-slate-600">Due: {hw.dueDate}</span>
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {hw.batchName} · {hw.subjectName} ({hw.chapterName}) · Assigned by {hw.teacherName}
                </div>
                <p className="text-xs text-slate-700 mt-2">{hw.instructions}</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600 font-semibold">
                      <th className="py-2.5 px-4">Student</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4">Feedback</th>
                      {hasPermission(Permission.HOMEWORK_MANAGE) && (
                        <th className="py-2.5 px-4 text-right">Mark</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {hw.submissions.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2.5 px-4">
                          <span className="font-semibold text-slate-900">{s.studentName}</span>{' '}
                          <span className="font-mono text-slate-500">({s.studentCode})</span>
                        </td>
                        <td className="py-2.5 px-4">
                          <StatusText status={s.effectiveStatus} />
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">{s.teacherFeedback || '—'}</td>
                        {hasPermission(Permission.HOMEWORK_MANAGE) && (
                          <td className="py-2.5 px-4 text-right space-x-1.5">
                            {s.status !== 'REVIEWED' && (
                              <button
                                type="button"
                                onClick={() => void handleReviewSubmission(s.id, 'REVIEWED')}
                                className="px-2.5 py-1 bg-slate-900 text-white font-semibold rounded"
                              >
                                Mark Reviewed
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <ModalDialog open={modalOpen} title="Assign Batch Homework" onClose={() => setModalOpen(false)}>
        <form onSubmit={handleAssign} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Batch</label>
              <select
                required
                value={form.batchId}
                onChange={(e) => setForm({ ...form, batchId: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              >
                <option value="">Select Batch</option>
                {acadLookup.data?.batches.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Subject</label>
              <select
                required
                value={form.subjectId}
                onChange={(e) => setForm({ ...form, subjectId: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              >
                <option value="">Select Subject</option>
                {acadLookup.data?.courses
                  .flatMap((c) => c.subjects)
                  .map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.code} — {s.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Chapter</label>
              <input
                type="text"
                required
                value={form.chapterName}
                onChange={(e) => setForm({ ...form, chapterName: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Due Date</label>
              <input
                type="date"
                required
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Assignment Title</label>
            <input
              type="text"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Instructions</label>
            <textarea
              required
              rows={2}
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Assign Homework
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
