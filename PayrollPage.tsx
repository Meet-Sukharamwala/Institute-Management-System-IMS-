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
  EmptyState,
  StatusText,
} from '../components/UiPrimitives';

interface PayrollItemRow {
  id: number;
  employeeCode: string;
  teacherName: string;
  salaryModel: string;
  completedLectures: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  grossPaise: number;
  totalDeductionsPaise: number;
  netPayablePaise: number;
  paymentStatus: string;
  disbursementRef: string;
  periodMonth?: string;
  branchName?: string;
}

interface PayrollRunRow {
  id: number;
  periodMonth: string;
  branchId: number;
  branchName: string;
  workingDays: number;
  status: string;
  calculatedByName: string;
  approvedByName: string | null;
  items: PayrollItemRow[];
}

export function PayrollPage() {
  const { branches, selectedBranchId, hasPermission, notify } = useAppContext();
  const qc = useQueryClient();

  const defaultBranch = selectedBranchId !== 'ALL' ? selectedBranchId : String(branches[0]?.id || 1);
  const [calcBranchId, setCalcBranchId] = useState(defaultBranch);
  const [periodMonth, setPeriodMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [workingDays, setWorkingDays] = useState('26');

  const query = useQuery({
    queryKey: ['payroll', selectedBranchId],
    queryFn: () =>
      apiFetch<{
        mode: 'OWN_ONLY' | 'MANAGEMENT';
        runs: PayrollRunRow[];
        myPayslips: PayrollItemRow[];
      }>(`/api/payroll?branchId=${encodeURIComponent(selectedBranchId)}`),
  });

  const handleCalculateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/payroll/calculate', {
        method: 'POST',
        body: {
          branchId: Number(calcBranchId),
          periodMonth,
          workingDays: Number(workingDays),
        },
      });
      notify('success', `Draft payroll calculated for ${periodMonth}.`);
      await qc.invalidateQueries({ queryKey: ['payroll'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Payroll calculation failed');
    }
  };

  const handleApproveRun = async (runId: number) => {
    try {
      await apiFetch(`/api/payroll/${runId}/approve`, { method: 'POST' });
      notify('success', 'Payroll run approved for disbursement.');
      await qc.invalidateQueries({ queryKey: ['payroll'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Approval failed');
    }
  };

  const handleDisburse = async (itemId: number) => {
    try {
      const res = await apiFetch<{ disbursementRef: string }>(
        `/api/payroll/items/${itemId}/disburse`,
        { method: 'POST', body: {} }
      );
      notify('success', `Salary disbursed (${res.disbursementRef}).`);
      await qc.invalidateQueries({ queryKey: ['payroll'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Disbursement failed');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faculty Salary & Restricted Payroll"
        subtitle="Policy-driven monthly, per-lecture, and hourly compensation with restricted administrative approval and payslip records."
      />

      {hasPermission(Permission.PAYROLL_CALCULATE) && (
        <form
          onSubmit={handleCalculateDraft}
          className="bg-white border border-slate-200 rounded-lg p-5 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Campus Branch</label>
            <select
              value={calcBranchId}
              onChange={(e) => setCalcBranchId(e.target.value)}
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">Payroll Month (YYYY-MM)</label>
            <input
              type="month"
              required
              value={periodMonth}
              onChange={(e) => setPeriodMonth(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Working Days</label>
            <input
              type="number"
              min={15}
              max={31}
              value={workingDays}
              onChange={(e) => setWorkingDays(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md whitespace-nowrap"
          >
            Calculate Draft Payroll
          </button>
        </form>
      )}

      {query.isLoading ? (
        <LoadingRows />
      ) : query.isError ? (
        <ErrorBanner message="Failed to load payroll records" onRetry={() => void query.refetch()} />
      ) : query.data?.mode === 'OWN_ONLY' ? (
        query.data.myPayslips.length === 0 ? (
          <EmptyState
            title="No payslips generated yet"
            description="Your monthly faculty payslips will appear here once payroll is calculated and approved."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <th className="py-3 px-4">Period</th>
                  <th className="py-3 px-4">Campus</th>
                  <th className="py-3 px-4 text-right">Gross</th>
                  <th className="py-3 px-4 text-right">Deductions</th>
                  <th className="py-3 px-4 text-right">Net Payable</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {query.data.myPayslips.map((item) => (
                  <tr key={item.id}>
                    <td className="py-3 px-4 font-mono font-semibold">{item.periodMonth}</td>
                    <td className="py-3 px-4">{item.branchName}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {formatInrDisplay(item.grossPaise)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {formatInrDisplay(item.totalDeductionsPaise)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold tabular-nums">
                      {formatInrDisplay(item.netPayablePaise)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={item.paymentStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : query.data?.runs.length === 0 ? (
        <EmptyState
          title="No payroll runs found"
          description="Select a campus branch and period month above to calculate draft payroll."
        />
      ) : (
        <div className="space-y-6">
          {query.data?.runs.map((run) => (
            <div key={run.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50">
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    Payroll Period {run.periodMonth} — {run.branchName}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    Prepared by {run.calculatedByName}
                    {run.approvedByName ? ` · Approved by ${run.approvedByName}` : ''} ·{' '}
                    <StatusText status={run.status} />
                  </div>
                </div>
                {run.status === 'DRAFT' && hasPermission(Permission.PAYROLL_APPROVE) && (
                  <button
                    type="button"
                    onClick={() => void handleApproveRun(run.id)}
                    className="px-3.5 py-1.5 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-md whitespace-nowrap"
                  >
                    Approve Payroll Run
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600 font-semibold">
                      <th className="py-2.5 px-4">Faculty</th>
                      <th className="py-2.5 px-4">Model</th>
                      <th className="py-2.5 px-4 text-right">Lectures / Days</th>
                      <th className="py-2.5 px-4 text-right">Leaves (P/U)</th>
                      <th className="py-2.5 px-4 text-right">Gross</th>
                      <th className="py-2.5 px-4 text-right">Deductions</th>
                      <th className="py-2.5 px-4 text-right">Net Payable</th>
                      <th className="py-2.5 px-4">Disbursement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {run.items.map((it) => (
                      <tr key={it.id}>
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900">{it.teacherName}</div>
                          <div className="font-mono text-slate-500">{it.employeeCode}</div>
                        </td>
                        <td className="py-2.5 px-4 text-slate-700">{it.salaryModel.replace(/_/g, ' ')}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {it.completedLectures} lec / {it.presentDays} d
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {it.paidLeaveDays} paid / {it.unpaidLeaveDays} unpaid
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {formatInrDisplay(it.grossPaise)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                          {formatInrDisplay(it.totalDeductionsPaise)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold tabular-nums text-slate-900">
                          {formatInrDisplay(it.netPayablePaise)}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center justify-between gap-2">
                            <StatusText status={it.paymentStatus} />
                            {it.paymentStatus === 'PENDING' &&
                              run.status === 'APPROVED' &&
                              hasPermission(Permission.PAYROLL_APPROVE) && (
                                <button
                                  type="button"
                                  onClick={() => void handleDisburse(it.id)}
                                  className="px-2.5 py-1 bg-slate-900 text-white font-semibold rounded whitespace-nowrap"
                                >
                                  Disburse
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
