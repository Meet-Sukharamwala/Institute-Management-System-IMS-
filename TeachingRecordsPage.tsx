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

interface SessionRow {
  id: number;
  sessionCode: string;
  branchId: number;
  branchName: string;
  batchId: number;
  batchName: string;
  subjectId: number;
  subjectName: string;
  assignedTeacherId: number;
  assignedTeacherName: string;
  substituteTeacherId: number | null;
  substituteTeacherName: string | null;
  conductedByTeacherName: string | null;
  sessionDate: string;
  scheduledStart: string;
  scheduledEnd: string;
  classroom: string;
  status: string;
  teachingRecordId: number | null;
  actualStart: string | null;
  actualEnd: string | null;
  chapterCovered: string | null;
  topicsSummary: string | null;
  homeworkAssigned: string | null;
  nextLessonPlan: string | null;
  studentObservations: string | null;
  remarks: string | null;
}

export function TeachingRecordsPage() {
  const { selectedBranchId, hasPermission, notify } = useAppContext();
  const qc = useQueryClient();
  const [dateFilter, setDateFilter] = useState('');
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(null);
  const [subModalSession, setSubModalSession] = useState<SessionRow | null>(null);

  const [recordForm, setRecordForm] = useState({
    actualStart: '10:15',
    actualEnd: '11:45',
    chapterCovered: '',
    topicsSummary: '',
    coverageStatus: 'COMPLETED' as 'COMPLETED' | 'PARTIALLY_COMPLETED',
    homeworkAssigned: '',
    nextLessonPlan: '',
    studentObservations: '',
    remarks: '',
  });

  const [subForm, setSubForm] = useState({
    status: 'SCHEDULED' as 'SCHEDULED' | 'IN_PROGRESS' | 'CANCELLED' | 'RESCHEDULED' | 'NOT_CONDUCTED',
    substituteTeacherId: '',
    reason: '',
  });

  const sessionsQuery = useQuery({
    queryKey: ['class-sessions', selectedBranchId, dateFilter],
    queryFn: () =>
      apiFetch<{ sessions: SessionRow[] }>(
        `/api/class-sessions?branchId=${encodeURIComponent(selectedBranchId)}&date=${encodeURIComponent(dateFilter)}`
      ),
  });

  const teachersQuery = useQuery({
    queryKey: ['teachers-for-sub', selectedBranchId],
    enabled: Boolean(subModalSession) && hasPermission(Permission.ACADEMIC_MANAGE),
    queryFn: () =>
      apiFetch<{ teachers: Array<{ id: number; fullName: string }> }>(
        `/api/teachers?branchId=${encodeURIComponent(selectedBranchId)}`
      ),
  });

  const openTeachingModal = (s: SessionRow) => {
    setSelectedSession(s);
    setRecordForm({
      actualStart: s.actualStart || s.scheduledStart,
      actualEnd: s.actualEnd || s.scheduledEnd,
      chapterCovered: s.chapterCovered || '',
      topicsSummary: s.topicsSummary || '',
      coverageStatus: s.status === 'PARTIALLY_COMPLETED' ? 'PARTIALLY_COMPLETED' : 'COMPLETED',
      homeworkAssigned: s.homeworkAssigned || '',
      nextLessonPlan: s.nextLessonPlan || '',
      studentObservations: s.studentObservations || '',
      remarks: s.remarks || '',
    });
  };

  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSession) return;
    try {
      await apiFetch('/api/teaching-records', {
        method: 'POST',
        body: {
          classSessionId: selectedSession.id,
          ...recordForm,
        },
      });
      notify('success', `Teaching record saved for ${selectedSession.sessionCode}.`);
      setSelectedSession(null);
      await qc.invalidateQueries({ queryKey: ['class-sessions'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to save teaching record');
    }
  };

  const handleSaveSubOrStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subModalSession) return;
    try {
      await apiFetch(`/api/class-sessions/${subModalSession.id}/substitute-or-status`, {
        method: 'PATCH',
        body: {
          status: subForm.status,
          substituteTeacherId: subForm.substituteTeacherId ? Number(subForm.substituteTeacherId) : null,
          reason: subForm.reason,
        },
      });
      notify('success', `Updated operational schedule for ${subModalSession.sessionCode}.`);
      setSubModalSession(null);
      await qc.invalidateQueries({ queryKey: ['class-sessions'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Update failed');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily Teaching Records & Substitution Log"
        subtitle="Authoritative log of what was taught on each date, who conducted each session, homework assigned, and next lesson plan."
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="tr-date" className="text-xs font-medium text-slate-600">
              Filter Date:
            </label>
            <input
              id="tr-date"
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter('')}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              >
                All Dates
              </button>
            )}
          </div>
        }
      />

      {sessionsQuery.isLoading ? (
        <LoadingRows />
      ) : sessionsQuery.isError ? (
        <ErrorBanner message="Failed to load scheduled sessions" onRetry={() => void sessionsQuery.refetch()} />
      ) : sessionsQuery.data?.sessions.length === 0 ? (
        <EmptyState
          title="No scheduled class sessions found"
          description="Clear the date filter or schedule a session from the Academics & Syllabus module."
        />
      ) : (
        <div className="space-y-4">
          {sessionsQuery.data?.sessions.map((s) => (
            <div key={s.id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-slate-900">{s.sessionCode}</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-sm font-bold text-slate-900">{s.subjectName}</span>
                    <span className="text-slate-300">·</span>
                    <StatusText status={s.status} />
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    {s.sessionDate} ({s.scheduledStart}–{s.scheduledEnd}) · {s.batchName} · Room {s.classroom} ·{' '}
                    Assigned: {s.assignedTeacherName}
                    {s.substituteTeacherName ? ` · Substitute: ${s.substituteTeacherName}` : ''}
                    {s.conductedByTeacherName ? ` · Conducted by: ${s.conductedByTeacherName}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {hasPermission(Permission.TEACHING_RECORD_SUBMIT) && (
                    <button
                      type="button"
                      onClick={() => openTeachingModal(s)}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md whitespace-nowrap"
                    >
                      {s.teachingRecordId ? 'Edit / Correct Teaching Record' : 'Submit Teaching Record'}
                    </button>
                  )}
                  {hasPermission(Permission.ACADEMIC_MANAGE) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSubModalSession(s);
                        setSubForm({
                          status: (s.status === 'COMPLETED' || s.status === 'PARTIALLY_COMPLETED'
                            ? 'SCHEDULED'
                            : s.status) as typeof subForm.status,
                          substituteTeacherId: s.substituteTeacherId ? String(s.substituteTeacherId) : '',
                          reason: '',
                        });
                      }}
                      className="px-3 py-1.5 border border-slate-300 hover:bg-slate-50 text-xs font-medium rounded-md whitespace-nowrap"
                    >
                      Substitute / Reschedule
                    </button>
                  )}
                </div>
              </div>

              {s.teachingRecordId ? (
                <div className="pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <div className="font-semibold text-slate-800">Chapter & Topics Taught</div>
                    <div className="text-slate-900 font-medium mt-0.5">{s.chapterCovered}</div>
                    <p className="text-slate-600 mt-0.5">{s.topicsSummary}</p>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800">Homework & Next Class Plan</div>
                    <div className="text-slate-700 mt-0.5">
                      <strong>Homework:</strong> {s.homeworkAssigned || 'None'}
                    </div>
                    <div className="text-slate-700 mt-0.5">
                      <strong>Next Lesson:</strong> {s.nextLessonPlan || 'TBA'}
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800">Actual Timing & Observations</div>
                    <div className="font-mono text-slate-700 mt-0.5">
                      Conducted: {s.actualStart} – {s.actualEnd}
                    </div>
                    {s.studentObservations && (
                      <div className="text-slate-600 mt-0.5">{s.studentObservations}</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="pt-2 border-t border-slate-100 text-xs text-amber-800">
                  Teaching record not yet submitted. Sessions are never marked completed automatically solely by clock time.
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Teaching Record Submission Modal */}
      <ModalDialog
        open={Boolean(selectedSession)}
        title={`Submit Teaching Record — ${selectedSession?.sessionCode || ''}`}
        onClose={() => setSelectedSession(null)}
      >
        <form onSubmit={handleSaveRecord} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Actual Start</label>
              <input
                type="time"
                required
                value={recordForm.actualStart}
                onChange={(e) => setRecordForm({ ...recordForm, actualStart: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Actual End</label>
              <input
                type="time"
                required
                value={recordForm.actualEnd}
                onChange={(e) => setRecordForm({ ...recordForm, actualEnd: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Coverage Status</label>
              <select
                value={recordForm.coverageStatus}
                onChange={(e) =>
                  setRecordForm({
                    ...recordForm,
                    coverageStatus: e.target.value as 'COMPLETED' | 'PARTIALLY_COMPLETED',
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              >
                <option value="COMPLETED">Completed</option>
                <option value="PARTIALLY_COMPLETED">Partially Completed</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Chapter Covered</label>
            <input
              type="text"
              required
              placeholder="e.g., Ch 2: Integral Calculus"
              value={recordForm.chapterCovered}
              onChange={(e) => setRecordForm({ ...recordForm, chapterCovered: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Detailed Topics Taught</label>
            <textarea
              required
              rows={3}
              value={recordForm.topicsSummary}
              onChange={(e) => setRecordForm({ ...recordForm, topicsSummary: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Homework Assigned</label>
              <input
                type="text"
                value={recordForm.homeworkAssigned}
                onChange={(e) => setRecordForm({ ...recordForm, homeworkAssigned: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Next Class Plan</label>
              <input
                type="text"
                value={recordForm.nextLessonPlan}
                onChange={(e) => setRecordForm({ ...recordForm, nextLessonPlan: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Student Observations / Remarks</label>
            <input
              type="text"
              value={recordForm.studentObservations}
              onChange={(e) => setRecordForm({ ...recordForm, studentObservations: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setSelectedSession(null)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Save Official Teaching Record
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Substitution / Cancellation Modal */}
      <ModalDialog
        open={Boolean(subModalSession)}
        title={`Substitute Teacher / Session Status — ${subModalSession?.sessionCode || ''}`}
        onClose={() => setSubModalSession(null)}
      >
        <form onSubmit={handleSaveSubOrStatus} className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Session Operational Status</label>
            <select
              value={subForm.status}
              onChange={(e) => setSubForm({ ...subForm, status: e.target.value as typeof subForm.status })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            >
              <option value="SCHEDULED">Scheduled</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="RESCHEDULED">Rescheduled</option>
              <option value="NOT_CONDUCTED">Not Conducted</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Assign Substitute Teacher (Preserves Original Assignment)</label>
            <select
              value={subForm.substituteTeacherId}
              onChange={(e) => setSubForm({ ...subForm, substituteTeacherId: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            >
              <option value="">No Substitute (Keep Original Teacher)</option>
              {teachersQuery.data?.teachers.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Reason / Schedule Note</label>
            <input
              type="text"
              required
              placeholder="e.g., Faculty on approved medical leave"
              value={subForm.reason}
              onChange={(e) => setSubForm({ ...subForm, reason: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setSubModalSession(null)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Update Schedule & Log History
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
