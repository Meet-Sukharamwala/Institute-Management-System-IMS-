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

interface ExamItem {
  id: number;
  examCode: string;
  title: string;
  branchId: number;
  branchName: string;
  batchId: number;
  batchName: string;
  subjectName: string;
  examDate: string;
  maxMarks: number;
  passingMarks: number;
  results: Array<{
    id: number;
    studentId: number;
    studentCode: string;
    studentName: string;
    marksObtained: number;
    percentage: number;
    grade: string;
    passed: number;
    remarks: string;
    isRetake: number;
  }>;
}

export function ExaminationsPage() {
  const { branches, selectedBranchId, hasPermission, notify } = useAppContext();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [marksTarget, setMarksTarget] = useState<ExamItem | null>(null);

  const defaultBranch = selectedBranchId !== 'ALL' ? selectedBranchId : String(branches[0]?.id || 1);
  const [examForm, setExamForm] = useState({
    title: '',
    branchId: defaultBranch,
    batchId: '',
    subjectId: '',
    examDate: new Date().toISOString().slice(0, 10),
    maxMarks: '100',
    passingMarks: '35',
  });

  const [marksForm, setMarksForm] = useState({
    studentId: '',
    marksObtained: '',
    remarks: '',
    allowCorrectionOrRetake: false,
  });

  const examsQuery = useQuery({
    queryKey: ['examinations', selectedBranchId],
    queryFn: () =>
      apiFetch<{ examinations: ExamItem[] }>(
        `/api/examinations?branchId=${encodeURIComponent(selectedBranchId)}`
      ),
  });

  const acadLookup = useQuery({
    queryKey: ['acad-exam-lookup', examForm.branchId],
    enabled: createOpen,
    queryFn: () =>
      apiFetch<{
        courses: Array<{ subjects: Array<{ id: number; code: string; name: string }> }>;
        batches: Array<{ id: number; code: string; name: string }>;
      }>(`/api/academics/overview?branchId=${encodeURIComponent(examForm.branchId)}`),
  });

  const batchStudentsLookup = useQuery({
    queryKey: ['exam-batch-students', marksTarget?.batchId],
    enabled: Boolean(marksTarget),
    queryFn: () =>
      apiFetch<{ students: Array<{ id: number; studentCode: string; fullName: string }> }>(
        `/api/students?batchId=${marksTarget?.batchId}&pageSize=100`
      ),
  });

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ examCode: string }>('/api/examinations', {
        method: 'POST',
        body: {
          title: examForm.title,
          branchId: Number(examForm.branchId),
          batchId: Number(examForm.batchId),
          subjectId: Number(examForm.subjectId),
          examDate: examForm.examDate,
          maxMarks: Number(examForm.maxMarks),
          passingMarks: Number(examForm.passingMarks),
        },
      });
      notify('success', `Examination ${res.examCode} created.`);
      setCreateOpen(false);
      await qc.invalidateQueries({ queryKey: ['examinations'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Could not create examination');
    }
  };

  const handleRecordMarks = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!marksTarget) return;
    try {
      await apiFetch(`/api/examinations/${marksTarget.id}/results`, {
        method: 'POST',
        body: {
          studentId: Number(marksForm.studentId),
          marksObtained: Number(marksForm.marksObtained),
          remarks: marksForm.remarks,
          allowCorrectionOrRetake: marksForm.allowCorrectionOrRetake,
        },
      });
      notify('success', 'Student marks validated and graded.');
      setMarksTarget(null);
      setMarksForm({ studentId: '', marksObtained: '', remarks: '', allowCorrectionOrRetake: false });
      await qc.invalidateQueries({ queryKey: ['examinations'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Marks entry failed');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Examinations & Academic Performance"
        subtitle="Create batch assessments, validate marks against maximum bounds, prevent duplicate entries, and compute Indian grades."
        actions={
          hasPermission(Permission.EXAM_MANAGE) ? (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md whitespace-nowrap"
            >
              Create Examination
            </button>
          ) : undefined
        }
      />

      {examsQuery.isLoading ? (
        <LoadingRows />
      ) : examsQuery.isError ? (
        <ErrorBanner message="Failed to load examinations" onRetry={() => void examsQuery.refetch()} />
      ) : examsQuery.data?.examinations.length === 0 ? (
        <EmptyState title="No examinations scheduled" description="Create a unit test or mock examination for a batch." />
      ) : (
        <div className="space-y-6">
          {examsQuery.data?.examinations.map((ex) => (
            <div key={ex.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    {ex.title} <span className="font-mono text-xs text-slate-500">({ex.examCode})</span>
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    {ex.batchName} · {ex.subjectName} · Date: {ex.examDate} · Max Marks: {ex.maxMarks} (Pass: {ex.passingMarks})
                  </div>
                </div>
                {hasPermission(Permission.EXAM_MANAGE) && (
                  <button
                    type="button"
                    onClick={() => setMarksTarget(ex)}
                    className="px-3.5 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-md whitespace-nowrap"
                  >
                    Enter / Correct Marks
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600 font-semibold">
                      <th className="py-2.5 px-4">Student</th>
                      <th className="py-2.5 px-4 text-right">Marks</th>
                      <th className="py-2.5 px-4 text-right">Percentage</th>
                      <th className="py-2.5 px-4">Grade</th>
                      <th className="py-2.5 px-4">Outcome</th>
                      <th className="py-2.5 px-4">Educator Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {ex.results.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-500">
                          Marks not yet recorded for this examination.
                        </td>
                      </tr>
                    ) : (
                      ex.results.map((r) => (
                        <tr key={r.id}>
                          <td className="py-2.5 px-4">
                            <span className="font-semibold text-slate-900">{r.studentName}</span>{' '}
                            <span className="font-mono text-slate-500">({r.studentCode})</span>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                            {r.marksObtained} / {ex.maxMarks}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">{r.percentage}%</td>
                          <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{r.grade}</td>
                          <td className="py-2.5 px-4">
                            <StatusText status={r.passed ? 'COMPLETED' : 'PENDING'} />
                          </td>
                          <td className="py-2.5 px-4 text-slate-600">
                            {r.remarks} {Boolean(r.isRetake) && '(Authorized Retake/Correction)'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Exam Modal */}
      <ModalDialog open={createOpen} title="Create Examination" onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreateExam} className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Examination Title</label>
            <input
              type="text"
              required
              placeholder="Unit Test 4 — Optics & Modern Physics"
              value={examForm.title}
              onChange={(e) => setExamForm({ ...examForm, title: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Batch</label>
              <select
                required
                value={examForm.batchId}
                onChange={(e) => setExamForm({ ...examForm, batchId: e.target.value })}
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
                value={examForm.subjectId}
                onChange={(e) => setExamForm({ ...examForm, subjectId: e.target.value })}
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Exam Date</label>
              <input
                type="date"
                required
                value={examForm.examDate}
                onChange={(e) => setExamForm({ ...examForm, examDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Max Marks</label>
              <input
                type="number"
                required
                min={1}
                value={examForm.maxMarks}
                onChange={(e) => setExamForm({ ...examForm, maxMarks: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Passing Marks</label>
              <input
                type="number"
                required
                min={0}
                value={examForm.passingMarks}
                onChange={(e) => setExamForm({ ...examForm, passingMarks: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Create Examination
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Enter Marks Modal */}
      <ModalDialog
        open={Boolean(marksTarget)}
        title={`Record Marks — ${marksTarget?.title || ''}`}
        onClose={() => setMarksTarget(null)}
      >
        <form onSubmit={handleRecordMarks} className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Student</label>
            <select
              required
              value={marksForm.studentId}
              onChange={(e) => setMarksForm({ ...marksForm, studentId: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            >
              <option value="">Select Enrolled Student</option>
              {batchStudentsLookup.data?.students.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.studentCode} — {s.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Marks Obtained (Out of {marksTarget?.maxMarks})
            </label>
            <input
              type="number"
              required
              min={0}
              max={marksTarget?.maxMarks || 100}
              step="0.5"
              value={marksForm.marksObtained}
              onChange={(e) => setMarksForm({ ...marksForm, marksObtained: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Supportive Educator Feedback</label>
            <input
              type="text"
              value={marksForm.remarks}
              onChange={(e) => setMarksForm({ ...marksForm, remarks: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={marksForm.allowCorrectionOrRetake}
              onChange={(e) => setMarksForm({ ...marksForm, allowCorrectionOrRetake: e.target.checked })}
            />
            <span>Authorized retake or correction of an existing result</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setMarksTarget(null)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Save Result
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
