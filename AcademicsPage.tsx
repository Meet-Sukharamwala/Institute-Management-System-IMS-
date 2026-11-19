import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAppContext } from '../context/AppContext';
import { Permission } from '../shared/types';
import { formatInrDisplay } from '../shared/domain-logic';
import {
  PageHeader,
  LoadingRows,
  ErrorBanner,
  StatusText,
  ModalDialog,
} from '../components/UiPrimitives';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface CourseItem {
  id: number;
  code: string;
  name: string;
  academicLevel: string;
  durationMonths: number;
  startDate: string;
  endDate: string;
  defaultFeePaise: number;
  branchId: number;
  branchName: string;
  status: string;
  subjects: Array<{
    id: number;
    code: string;
    name: string;
    topics: Array<{ id: number; chapterName: string; topicTitle: string; plannedDate: string | null }>;
  }>;
}

interface BatchItem {
  id: number;
  code: string;
  name: string;
  courseId: number;
  courseName: string;
  branchId: number;
  branchName: string;
  classroom: string;
  maxCapacity: number;
  enrolledCount: number;
  status: string;
  syllabusProgress: {
    totalTopics: number;
    completedTopics: number;
    partialTopics: number;
    pendingTopics: number;
    coveragePercentage: number;
  };
  syllabusTopics: Array<{
    topicId: number;
    chapterName: string;
    topicTitle: string;
    subjectName: string;
    status: string;
    completedOn: string | null;
  }>;
}

interface TimetableSlot {
  id: number;
  batchName: string;
  subjectName: string;
  teacherName: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  classroom: string;
}

export function AcademicsPage() {
  const { branches, selectedBranchId, hasPermission, notify } = useAppContext();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'batches' | 'courses' | 'timetable'>('batches');
  const [courseModal, setCourseModal] = useState(false);
  const [batchModal, setBatchModal] = useState(false);
  const [sessionModal, setSessionModal] = useState(false);

  const defaultBranch = selectedBranchId !== 'ALL' ? selectedBranchId : String(branches[0]?.id || 1);

  const [courseForm, setCourseForm] = useState({
    code: '',
    name: '',
    academicLevel: 'Class 12 Science',
    durationMonths: '12',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    defaultFeeInr: '75000',
    branchId: defaultBranch,
    subjectCode: 'PHY-ADV',
    subjectName: 'Physics Core',
  });

  const [batchForm, setBatchForm] = useState({
    code: '',
    name: '',
    courseId: '',
    branchId: defaultBranch,
    classroom: 'Hall 102',
    maxCapacity: '35',
    startDate: '2026-04-10',
    endDate: '2027-03-20',
  });

  const [sessionForm, setSessionForm] = useState({
    branchId: defaultBranch,
    batchId: '',
    subjectId: '',
    assignedTeacherId: '',
    sessionDate: new Date().toISOString().slice(0, 10),
    scheduledStart: '14:00',
    scheduledEnd: '15:30',
    classroom: 'Hall 201',
  });

  const query = useQuery({
    queryKey: ['academics-overview', selectedBranchId],
    queryFn: () =>
      apiFetch<{
        courses: CourseItem[];
        batches: BatchItem[];
        timetableSlots: TimetableSlot[];
      }>(`/api/academics/overview?branchId=${encodeURIComponent(selectedBranchId)}`),
  });

  const teachersQuery = useQuery({
    queryKey: ['teachers-lookup', sessionForm.branchId],
    enabled: sessionModal && hasPermission(Permission.TEACHER_VIEW, Permission.ACADEMIC_MANAGE),
    queryFn: () =>
      apiFetch<{ teachers: Array<{ id: number; fullName: string }> }>(
        `/api/teachers?branchId=${encodeURIComponent(sessionForm.branchId)}`
      ),
  });

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/courses', {
        method: 'POST',
        body: {
          code: courseForm.code,
          name: courseForm.name,
          academicLevel: courseForm.academicLevel,
          durationMonths: Number(courseForm.durationMonths),
          startDate: courseForm.startDate,
          endDate: courseForm.endDate,
          defaultFeeInr: Number(courseForm.defaultFeeInr),
          branchId: Number(courseForm.branchId),
          initialSubjects: courseForm.subjectCode
            ? [{ code: courseForm.subjectCode, name: courseForm.subjectName, topics: [] }]
            : [],
        },
      });
      notify('success', `Course ${courseForm.code.toUpperCase()} created.`);
      setCourseModal(false);
      await qc.invalidateQueries({ queryKey: ['academics-overview'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to create course');
    }
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/batches', {
        method: 'POST',
        body: {
          code: batchForm.code,
          name: batchForm.name,
          courseId: Number(batchForm.courseId),
          branchId: Number(batchForm.branchId),
          classroom: batchForm.classroom,
          maxCapacity: Number(batchForm.maxCapacity),
          startDate: batchForm.startDate,
          endDate: batchForm.endDate,
        },
      });
      notify('success', `Batch ${batchForm.code.toUpperCase()} created.`);
      setBatchModal(false);
      await qc.invalidateQueries({ queryKey: ['academics-overview'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to create batch');
    }
  };

  const handleScheduleSession = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ sessionCode: string }>('/api/class-sessions', {
        method: 'POST',
        body: {
          branchId: Number(sessionForm.branchId),
          batchId: Number(sessionForm.batchId),
          subjectId: Number(sessionForm.subjectId),
          assignedTeacherId: Number(sessionForm.assignedTeacherId),
          sessionDate: sessionForm.sessionDate,
          scheduledStart: sessionForm.scheduledStart,
          scheduledEnd: sessionForm.scheduledEnd,
          classroom: sessionForm.classroom,
        },
      });
      notify('success', `Class session ${res.sessionCode} scheduled (no conflicts).`);
      setSessionModal(false);
      await qc.invalidateQueries({ queryKey: ['class-sessions'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Schedule conflict detected');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Courses, Batches, Syllabus & Timetable"
        subtitle="Track deduplicated syllabus topic coverage per batch, manage courses, and schedule conflict-checked class sessions."
        actions={
          hasPermission(Permission.ACADEMIC_MANAGE) ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSessionModal(true)}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md whitespace-nowrap"
              >
                Schedule Class Session
              </button>
              <button
                type="button"
                onClick={() => setBatchModal(true)}
                className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-900 text-xs font-semibold rounded-md whitespace-nowrap"
              >
                New Batch
              </button>
              <button
                type="button"
                onClick={() => setCourseModal(true)}
                className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-900 text-xs font-semibold rounded-md whitespace-nowrap"
              >
                New Course
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        {(['batches', 'courses', 'timetable'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md capitalize whitespace-nowrap ${
              tab === t ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t === 'batches' ? 'Batches & Syllabus Progress' : t === 'courses' ? 'Courses & Subjects' : 'Weekly Timetable'}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <LoadingRows />
      ) : query.isError ? (
        <ErrorBanner message="Failed to load academic data" onRetry={() => void query.refetch()} />
      ) : (
        <>
          {tab === 'batches' && (
            <div className="space-y-4">
              {query.data?.batches.map((b) => (
                <div key={b.id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <div className="text-base font-bold text-slate-900">
                        {b.name} <span className="font-mono text-xs text-slate-500">({b.code})</span>
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        {b.courseName} · {b.branchName} · Room {b.classroom || 'TBA'} ·{' '}
                        <span className="font-mono tabular-nums">
                          {b.enrolledCount}/{b.maxCapacity} students
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                        {b.syllabusProgress.coveragePercentage}% Syllabus Covered
                      </div>
                      <div className="text-xs text-slate-600 tabular-nums">
                        {b.syllabusProgress.completedTopics} completed · {b.syllabusProgress.partialTopics} partial ·{' '}
                        {b.syllabusProgress.pendingTopics} pending
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-slate-900 transition-all"
                      style={{ width: `${Math.min(100, b.syllabusProgress.coveragePercentage)}%` }}
                    />
                  </div>

                  {b.syllabusTopics.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                            <th className="py-2 pr-3">Subject</th>
                            <th className="py-2 px-3">Chapter</th>
                            <th className="py-2 px-3">Syllabus Topic</th>
                            <th className="py-2 pl-3 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {b.syllabusTopics.map((tp) => (
                            <tr key={tp.topicId}>
                              <td className="py-2 pr-3 text-slate-700">{tp.subjectName}</td>
                              <td className="py-2 px-3 text-slate-700">{tp.chapterName}</td>
                              <td className="py-2 px-3 font-medium text-slate-900">{tp.topicTitle}</td>
                              <td className="py-2 pl-3 text-right">
                                <StatusText status={tp.status} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'courses' && (
            <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Code</th>
                    <th className="py-3 px-4">Course & Level</th>
                    <th className="py-3 px-4">Subjects & Topics</th>
                    <th className="py-3 px-4">Branch</th>
                    <th className="py-3 px-4 text-right">Standard Fee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {query.data?.courses.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900">{c.code}</td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{c.name}</div>
                        <div className="text-xs text-slate-500">
                          {c.academicLevel} · {c.durationMonths} months ({c.startDate} to {c.endDate})
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700">
                        {c.subjects.map((s) => `${s.name} (${s.topics.length} topics)`).join(' · ')}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">{c.branchName}</td>
                      <td className="py-3 px-4 text-right font-mono text-xs font-semibold tabular-nums">
                        {formatInrDisplay(c.defaultFeePaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'timetable' && (
            <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Day</th>
                    <th className="py-3 px-4">Time Window</th>
                    <th className="py-3 px-4">Batch</th>
                    <th className="py-3 px-4">Subject</th>
                    <th className="py-3 px-4">Assigned Faculty</th>
                    <th className="py-3 px-4">Classroom</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {query.data?.timetableSlots.map((slot) => (
                    <tr key={slot.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-semibold text-slate-900">{DAY_NAMES[slot.dayOfWeek]}</td>
                      <td className="py-3 px-4 font-mono text-xs tabular-nums">
                        {slot.startTime} – {slot.endTime}
                      </td>
                      <td className="py-3 px-4 text-xs font-medium text-slate-900">{slot.batchName}</td>
                      <td className="py-3 px-4 text-xs text-slate-700">{slot.subjectName}</td>
                      <td className="py-3 px-4 text-xs text-slate-700">{slot.teacherName}</td>
                      <td className="py-3 px-4 text-xs font-mono text-slate-600">{slot.classroom}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* New Course Modal */}
      <ModalDialog open={courseModal} title="Create Academic Course" onClose={() => setCourseModal(false)}>
        <form onSubmit={handleCreateCourse} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Course Code</label>
              <input
                type="text"
                required
                placeholder="CRS-CET27"
                value={courseForm.code}
                onChange={(e) => setCourseForm({ ...courseForm, code: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Course Name</label>
              <input
                type="text"
                required
                value={courseForm.name}
                onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Academic Level</label>
              <input
                type="text"
                required
                value={courseForm.academicLevel}
                onChange={(e) => setCourseForm({ ...courseForm, academicLevel: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Standard Fee (₹)</label>
              <input
                type="number"
                required
                value={courseForm.defaultFeeInr}
                onChange={(e) => setCourseForm({ ...courseForm, defaultFeeInr: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Campus Branch</label>
              <select
                value={courseForm.branchId}
                onChange={(e) => setCourseForm({ ...courseForm, branchId: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              >
                {branches.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCourseModal(false)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Create Course
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* New Batch Modal */}
      <ModalDialog open={batchModal} title="Create Academic Batch" onClose={() => setBatchModal(false)}>
        <form onSubmit={handleCreateBatch} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Batch Code</label>
              <input
                type="text"
                required
                placeholder="BTH-JEE-E2"
                value={batchForm.code}
                onChange={(e) => setBatchForm({ ...batchForm, code: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Batch Name</label>
              <input
                type="text"
                required
                value={batchForm.name}
                onChange={(e) => setBatchForm({ ...batchForm, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Course</label>
              <select
                required
                value={batchForm.courseId}
                onChange={(e) => setBatchForm({ ...batchForm, courseId: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              >
                <option value="">Select Course</option>
                {query.data?.courses.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Classroom & Capacity</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={batchForm.classroom}
                  onChange={(e) => setBatchForm({ ...batchForm, classroom: e.target.value })}
                  placeholder="Hall 102"
                  className="w-2/3 px-3 py-2 border border-slate-300 rounded-md"
                />
                <input
                  type="number"
                  value={batchForm.maxCapacity}
                  onChange={(e) => setBatchForm({ ...batchForm, maxCapacity: e.target.value })}
                  className="w-1/3 px-3 py-2 border border-slate-300 rounded-md font-mono"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setBatchModal(false)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Create Batch
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Schedule Conflict-Checked Class Session Modal */}
      <ModalDialog open={sessionModal} title="Schedule Class Session (Conflict-Checked)" onClose={() => setSessionModal(false)}>
        <form onSubmit={handleScheduleSession} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Batch</label>
              <select
                required
                value={sessionForm.batchId}
                onChange={(e) => {
                  const b = query.data?.batches.find((x) => String(x.id) === e.target.value);
                  setSessionForm({
                    ...sessionForm,
                    batchId: e.target.value,
                    branchId: b ? String(b.branchId) : sessionForm.branchId,
                    classroom: b?.classroom || sessionForm.classroom,
                  });
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              >
                <option value="">Select Batch</option>
                {query.data?.batches.map((b) => (
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
                value={sessionForm.subjectId}
                onChange={(e) => setSessionForm({ ...sessionForm, subjectId: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              >
                <option value="">Select Subject</option>
                {query.data?.courses
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
              <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Faculty</label>
              <select
                required
                value={sessionForm.assignedTeacherId}
                onChange={(e) => setSessionForm({ ...sessionForm, assignedTeacherId: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              >
                <option value="">Select Faculty</option>
                {teachersQuery.data?.teachers.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Classroom</label>
              <input
                type="text"
                required
                value={sessionForm.classroom}
                onChange={(e) => setSessionForm({ ...sessionForm, classroom: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Session Date</label>
              <input
                type="date"
                required
                value={sessionForm.sessionDate}
                onChange={(e) => setSessionForm({ ...sessionForm, sessionDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Start Time</label>
              <input
                type="time"
                required
                value={sessionForm.scheduledStart}
                onChange={(e) => setSessionForm({ ...sessionForm, scheduledStart: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">End Time</label>
              <input
                type="time"
                required
                value={sessionForm.scheduledEnd}
                onChange={(e) => setSessionForm({ ...sessionForm, scheduledEnd: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setSessionModal(false)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Verify Conflicts & Schedule
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
