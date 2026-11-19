import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { apiFetch } from '../lib/api';
import { useAppContext } from '../context/AppContext';
import { Permission, RoleCode } from '../shared/types';
import { formatInrDisplay } from '../shared/domain-logic';
import { PageHeader, LoadingRows, ErrorBanner } from '../components/UiPrimitives';

interface DashboardPayload {
  date: string;
  studentStats: {
    activeStudents: number;
    newAdmissions: number;
    presentToday: number;
    absentToday: number;
    studentsWithOverdueFees: number;
    studentsOnLeave: number;
  };
  teacherStats: {
    activeTeachers: number;
    teachersCheckedIn: number;
    teachersCheckedOut: number;
    teachersNotCheckedIn: number;
  };
  academicStats: {
    classesScheduledToday: number;
    classesInProgress: number;
    classesCompleted: number;
    classesCancelledOrRescheduled: number;
    missingTeachingRecords: number;
    pendingTopics: number;
  };
  financialStats: {
    todayCollectionPaise: number;
    monthlyCollectionPaise: number;
    outstandingFeesPaise: number;
    pendingSalaryPaise: number;
    approvedPayrollPaise: number;
  } | null;
  alerts: {
    missingExitsCount: number;
    pendingLeavesCount: number;
    studentsWithOverdueFees: number;
  };
  batchChart: Array<{
    batchCode: string;
    batchName: string;
    students: number;
    avgExamScore: number;
  }>;
  recentAudit: Array<{
    id: number;
    actorName: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: string;
  }>;
}

export function DashboardPage() {
  const { user, selectedBranchId, hasPermission } = useAppContext();
  const [dateFilter, setDateFilter] = useState(() => new Date().toISOString().slice(0, 10));

  if (
    user &&
    (user.roleCode === RoleCode.STUDENT || user.roleCode === RoleCode.PARENT) &&
    !hasPermission(Permission.DASHBOARD_VIEW)
  ) {
    return <Navigate to="/portal" replace />;
  }

  const query = useQuery({
    queryKey: ['dashboard', selectedBranchId, dateFilter],
    queryFn: () =>
      apiFetch<DashboardPayload>(
        `/api/dashboard?branchId=${encodeURIComponent(selectedBranchId)}&date=${encodeURIComponent(dateFilter)}`
      ),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Operational Overview" subtitle="Loading live campus metrics..." />
        <LoadingRows rows={6} />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Operational Overview" />
        <ErrorBanner
          message={query.error instanceof Error ? query.error.message : 'Failed to load dashboard'}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const d = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operational Dashboard"
        subtitle="Authoritative campus metrics across admissions, attendance, syllabus delivery, and fee ledgers."
        actions={
          <div className="flex items-center gap-2.5">
            <label htmlFor="dash-date" className="text-xs font-medium text-slate-600">
              Operational Date
            </label>
            <input
              id="dash-date"
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
            />
            {hasPermission(Permission.STUDENT_MANAGE) && (
              <Link
                to="/students"
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md whitespace-nowrap"
              >
                New Admission
              </Link>
            )}
          </div>
        }
      />

      {/* Actionable Operational Alerts */}
      {(d.alerts.missingExitsCount > 0 ||
        d.alerts.pendingLeavesCount > 0 ||
        d.alerts.studentsWithOverdueFees > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-4 text-xs text-amber-950">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold">Attention Required:</span>
            {d.alerts.missingExitsCount > 0 && (
              <Link to="/entry-exit" className="underline hover:text-slate-900">
                {d.alerts.missingExitsCount} campus entry record(s) without checkout
              </Link>
            )}
            {d.alerts.pendingLeavesCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <Link to="/leaves" className="underline hover:text-slate-900">
                  {d.alerts.pendingLeavesCount} pending leave request(s)
                </Link>
              </>
            )}
            {d.alerts.studentsWithOverdueFees > 0 && hasPermission(Permission.FEE_VIEW) && (
              <>
                <span aria-hidden="true">·</span>
                <Link to="/fees" className="underline hover:text-slate-900">
                  {d.alerts.studentsWithOverdueFees} student(s) with overdue fee assessments
                </Link>
              </>
            )}
          </div>
          <Link to="/teacher-verification" className="font-semibold underline whitespace-nowrap">
            Open Host Verification Desk
          </Link>
        </div>
      )}

      {/* Primary KPI Grid — Single-elevation bordered panels, tabular numerals */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <section className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-600">Students & Attendance</h2>
            <Link to="/students" className="text-xs text-slate-700 underline">
              Directory
            </Link>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {d.studentStats.activeStudents}
          </div>
          <div className="mt-2 text-xs text-slate-600 tabular-nums">
            <span>{d.studentStats.newAdmissions} admitted this month</span>
            <span className="mx-1.5">·</span>
            <span className="text-emerald-700 font-medium">{d.studentStats.presentToday} present</span>
            <span className="mx-1.5">·</span>
            <span className="text-red-700 font-medium">{d.studentStats.absentToday} absent</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {d.studentStats.studentsOnLeave} on approved leave · {d.studentStats.studentsWithOverdueFees} overdue fees
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-600">Faculty Verification</h2>
            <Link to="/teacher-verification" className="text-xs text-slate-700 underline">
              Verify
            </Link>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {d.teacherStats.teachersCheckedIn + d.teacherStats.teachersCheckedOut} / {d.teacherStats.activeTeachers}
          </div>
          <div className="mt-2 text-xs text-slate-600 tabular-nums">
            <span className="text-emerald-700 font-medium">{d.teacherStats.teachersCheckedIn} active on-site</span>
            <span className="mx-1.5">·</span>
            <span>{d.teacherStats.teachersCheckedOut} checked out</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {d.teacherStats.teachersNotCheckedIn} faculty not yet checked in on {d.date}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-600">Classes & Syllabus</h2>
            <Link to="/teaching-records" className="text-xs text-slate-700 underline">
              Teaching Logs
            </Link>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {d.academicStats.classesCompleted} / {d.academicStats.classesScheduledToday}
          </div>
          <div className="mt-2 text-xs text-slate-600 tabular-nums">
            <span>{d.academicStats.classesInProgress} in progress</span>
            <span className="mx-1.5">·</span>
            <span>{d.academicStats.missingTeachingRecords} awaiting teaching log</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {d.academicStats.pendingTopics} pending syllabus topics · {d.academicStats.classesCancelledOrRescheduled} rescheduled
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-600">Confirmed Fee & Payroll</h2>
            {hasPermission(Permission.FEE_VIEW) && (
              <Link to="/fees" className="text-xs text-slate-700 underline">
                Ledger
              </Link>
            )}
          </div>
          {d.financialStats ? (
            <>
              <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
                {formatInrDisplay(d.financialStats.monthlyCollectionPaise)}
              </div>
              <div className="mt-2 text-xs text-slate-600 tabular-nums">
                <span className="text-emerald-700 font-medium">
                  Today: {formatInrDisplay(d.financialStats.todayCollectionPaise)}
                </span>
                <span className="mx-1.5">·</span>
                <span className="text-red-700 font-medium">
                  Due: {formatInrDisplay(d.financialStats.outstandingFeesPaise)}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                Pending salary disbursement: {formatInrDisplay(d.financialStats.pendingSalaryPaise)}
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              Financial ledger figures are restricted to authorized administrative and accounting roles.
            </p>
          )}
        </section>
      </div>

      {/* Analytics Chart + Recent Protected Audit Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Batch Enrolment & Examination Mean (%)</h2>
              <p className="text-xs text-slate-600">
                Active student headcount vs published examination score average per batch
              </p>
            </div>
            <Link to="/examinations" className="text-xs font-medium text-slate-700 underline">
              View Results
            </Link>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.batchChart} margin={{ top: 8, right: 8, left: -12, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="batchCode" tick={{ fontSize: 12, fill: '#475569' }} />
                <YAxis
                  yAxisId="left"
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#0f172a' }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 100]}
                  unit="%"
                  tick={{ fontSize: 11, fill: '#0284c7' }}
                />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar
                  yAxisId="left"
                  dataKey="students"
                  name="Enrolled Students"
                  fill="#0f172a"
                  barSize={28}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  yAxisId="right"
                  dataKey="avgExamScore"
                  name="Mean Exam %"
                  fill="#0284c7"
                  barSize={28}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-slate-900">Recent Institutional Audit Trail</h2>
            {hasPermission(Permission.AUDIT_VIEW) && (
              <Link to="/administration" className="text-xs font-medium text-slate-700 underline">
                Full Log
              </Link>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {d.recentAudit.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No recent operational events recorded.</p>
            ) : (
              d.recentAudit.map((log) => (
                <div key={log.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">
                      {log.action.replace(/_/g, ' ')}
                    </div>
                    <div className="text-slate-600 truncate">
                      {log.actorName} ({log.actorRole}) · {log.entityType} #{log.entityId}
                    </div>
                  </div>
                  <span className="font-mono text-slate-500 shrink-0 tabular-nums">
                    {log.createdAt.slice(11, 16)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
