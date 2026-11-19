import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAppContext } from '../context/AppContext';
import { RoleCode } from '../shared/types';
import { formatInrDisplay } from '../shared/domain-logic';
import {
  PageHeader,
  LoadingRows,
  ErrorBanner,
  EmptyState,
  StatusText,
} from '../components/UiPrimitives';

interface PortalStudentData {
  profile: {
    id: number;
    studentCode: string;
    fullName: string;
    academicLevel: string;
    branchName: string;
    status: string;
  };
  batches: Array<{ id: number; code: string; name: string; courseName: string; classroom: string }>;
  attendanceSummary: {
    conductedCount: number;
    presentCount: number;
    lateCount: number;
    absentCount: number;
    attendancePercentage: number;
  };
  movements: Array<{
    movementDate: string;
    entryTime: string;
    exitTime: string | null;
    exceptionReason: string;
  }>;
  homework: Array<{
    id: number;
    title: string;
    chapterName: string;
    subjectName: string;
    dueDate: string;
    status: string;
    teacherFeedback: string;
  }>;
  examResults: Array<{
    examTitle: string;
    examDate: string;
    subjectName: string;
    marksObtained: number;
    maxMarks: number;
    percentage: number;
    grade: string;
    remarks: string;
  }>;
  feeAssessments: Array<{
    id: number;
    title: string;
    dueDate: string;
    outstandingPaise: number;
    status: string;
  }>;
  receipts: Array<{
    receiptNumber: string;
    amountPaise: number;
    paymentMethod: string;
    paymentDate: string;
    status: string;
  }>;
  syllabusProgress: {
    coveragePercentage: number;
    completedTopics: number;
    totalTopics: number;
  };
}

function StudentPortalView({ data }: { data: PortalStudentData }) {
  const totalDue = data.feeAssessments.reduce((acc, a) => acc + a.outstandingPaise, 0);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div>
          <div className="text-xs text-slate-500">Student Profile</div>
          <div className="text-base font-bold text-slate-900 mt-0.5">{data.profile.fullName}</div>
          <div className="text-xs font-mono text-slate-600">
            {data.profile.studentCode} · {data.profile.academicLevel}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Classroom Attendance</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {data.attendanceSummary.attendancePercentage}%
          </div>
          <div className="text-xs text-slate-600 tabular-nums">
            {data.attendanceSummary.presentCount + data.attendanceSummary.lateCount} attended /{' '}
            {data.attendanceSummary.conductedCount} conducted
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Batch Syllabus Progress</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {data.syllabusProgress.coveragePercentage}%
          </div>
          <div className="text-xs text-slate-600 tabular-nums">
            {data.syllabusProgress.completedTopics} of {data.syllabusProgress.totalTopics} topics completed
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Fee Balance</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {formatInrDisplay(totalDue)}
          </div>
          <div className="text-xs text-slate-600">{data.receipts.length} posted receipt(s)</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Examination Results</h3>
          {data.examResults.length === 0 ? (
            <p className="text-xs text-slate-500">No published examination results yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 text-xs">
              {data.examResults.map((er, idx) => (
                <div key={idx} className="py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">{er.examTitle}</div>
                    <div className="text-slate-500">
                      {er.subjectName} · {er.examDate} · {er.remarks}
                    </div>
                  </div>
                  <div className="text-right font-mono shrink-0">
                    <div className="font-bold text-slate-900">
                      {er.marksObtained}/{er.maxMarks} ({er.grade})
                    </div>
                    <div className="text-slate-600">{er.percentage}%</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Homework & Campus Gate Movements</h3>
          <div className="divide-y divide-slate-100 text-xs">
            {data.homework.map((hw) => (
              <div key={hw.id} className="py-2 flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">{hw.title}</div>
                  <div className="text-slate-500">
                    {hw.subjectName} · Due {hw.dueDate}
                  </div>
                </div>
                <StatusText status={hw.status} />
              </div>
            ))}
          </div>
          {data.movements.length > 0 && (
            <div className="pt-3 border-t border-slate-200 text-xs">
              <div className="font-semibold text-slate-800 mb-1.5">Recent Campus Entry/Exit Logs</div>
              {data.movements.slice(0, 3).map((m, i) => (
                <div key={i} className="font-mono text-slate-600 py-0.5">
                  {m.movementDate}: In {m.entryTime} → Out {m.exitTime || 'On Campus'}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function PortalPage() {
  const { user } = useAppContext();
  const isParent = user?.roleCode === RoleCode.PARENT;

  const studentQuery = useQuery({
    queryKey: ['portal-student'],
    enabled: user?.roleCode === RoleCode.STUDENT,
    queryFn: () => apiFetch<PortalStudentData>('/api/portal/student'),
  });

  const parentQuery = useQuery({
    queryKey: ['portal-parent'],
    enabled: isParent,
    queryFn: () => apiFetch<{ children: PortalStudentData[] }>('/api/portal/parent'),
  });

  if (studentQuery.isLoading || parentQuery.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Academic & Fee Portal" />
        <LoadingRows />
      </div>
    );
  }

  if (studentQuery.isError || parentQuery.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Academic & Fee Portal" />
        <ErrorBanner message="Could not load portal records." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isParent ? 'Parent / Guardian Portal' : 'Student Academic Portal'}
        subtitle={
          isParent
            ? 'Server-verified guardian access restricted exclusively to your linked child records.'
            : 'Personal timetable, attendance, homework, examination results, and fee receipts.'
        }
      />

      {isParent ? (
        parentQuery.data?.children.length ? (
          parentQuery.data.children.map((child) => (
            <StudentPortalView key={child.profile.id} data={child} />
          ))
        ) : (
          <EmptyState
            title="No linked student records"
            description="Contact campus administration to link your guardian account."
          />
        )
      ) : studentQuery.data ? (
        <StudentPortalView data={studentQuery.data} />
      ) : null}
    </div>
  );
}
