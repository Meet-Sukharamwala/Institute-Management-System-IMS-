import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
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

interface AssessmentItem {
  id: number;
  studentId: number;
  studentCode: string;
  studentName: string;
  branchName: string;
  batchName: string | null;
  title: string;
  grossAmountPaise: number;
  discountPaise: number;
  adjustmentPaise: number;
  netPayablePaise: number;
  effectivePaidPaise: number;
  outstandingPaise: number;
  dueDate: string;
  status: string;
}

interface PaymentItem {
  id: number;
  receiptNumber: string;
  studentId: number;
  studentCode: string;
  studentName: string;
  branchName: string;
  branchAddress: string;
  branchPhone: string;
  amountPaise: number;
  paymentMethod: string;
  referenceNo: string;
  status: string;
  paymentDate: string;
  notes: string;
  issuerName: string;
  reversalReason: string;
}

export function FeesPage() {
  const { selectedBranchId, hasPermission, notify } = useAppContext();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'ledger' | 'receipts'>('ledger');

  const [paymentModal, setPaymentModal] = useState<{ studentId: number; studentName: string; maxInr: number } | null>(
    null
  );
  const [payForm, setPayForm] = useState({
    amountInr: '',
    paymentMethod: 'UPI' as 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE',
    referenceNo: '',
    paymentDate: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  const [assessModal, setAssessModal] = useState(false);
  const [assessForm, setAssessForm] = useState({
    studentId: '',
    title: 'Term Tuition Instalment',
    grossAmountInr: '25000',
    discountInr: '0',
    discountReason: '',
    dueDate: new Date().toISOString().slice(0, 10),
  });

  const [reverseTarget, setReverseTarget] = useState<PaymentItem | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [printReceipt, setPrintReceipt] = useState<PaymentItem | null>(null);

  const ledgerQuery = useQuery({
    queryKey: ['fees-ledger', selectedBranchId],
    queryFn: () =>
      apiFetch<{ assessments: AssessmentItem[]; payments: PaymentItem[] }>(
        `/api/fees/ledger?branchId=${encodeURIComponent(selectedBranchId)}`
      ),
  });

  const studentsLookup = useQuery({
    queryKey: ['students-fee-lookup', selectedBranchId],
    enabled: assessModal,
    queryFn: () =>
      apiFetch<{ students: Array<{ id: number; studentCode: string; fullName: string }> }>(
        `/api/students?branchId=${encodeURIComponent(selectedBranchId)}&pageSize=100`
      ),
  });

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModal) return;
    try {
      const res = await apiFetch<{ receiptNumber: string }>('/api/payments', {
        method: 'POST',
        body: {
          studentId: paymentModal.studentId,
          amountInr: Number(payForm.amountInr),
          paymentMethod: payForm.paymentMethod,
          referenceNo: payForm.referenceNo,
          paymentDate: payForm.paymentDate,
          notes: payForm.notes,
          idempotencyKey: `ui-pay-${paymentModal.studentId}-${Date.now()}`,
        },
      });
      notify('success', `Payment posted and allocated via FIFO. Receipt ${res.receiptNumber} generated.`);
      setPaymentModal(null);
      await qc.invalidateQueries({ queryKey: ['fees-ledger'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Payment failed');
    }
  };

  const handleCreateAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/fees/assessments', {
        method: 'POST',
        body: {
          studentId: Number(assessForm.studentId),
          title: assessForm.title,
          grossAmountInr: Number(assessForm.grossAmountInr),
          discountInr: Number(assessForm.discountInr || 0),
          discountReason: assessForm.discountReason,
          dueDate: assessForm.dueDate,
        },
      });
      notify('success', 'New fee obligation added to student ledger.');
      setAssessModal(false);
      await qc.invalidateQueries({ queryKey: ['fees-ledger'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Could not create fee assessment');
    }
  };

  const handleReversePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reverseTarget) return;
    try {
      await apiFetch(`/api/payments/${reverseTarget.id}/reverse`, {
        method: 'POST',
        body: { reason: reversalReason },
      });
      notify('info', `Receipt ${reverseTarget.receiptNumber} reversed with full audit history preserved.`);
      setReverseTarget(null);
      setReversalReason('');
      await qc.invalidateQueries({ queryKey: ['fees-ledger'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Reversal failed');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Student Fee Ledgers, Payments & Receipts"
        subtitle="Transaction-safe integer paise accounting, FIFO obligation allocation, printable official receipts, and non-destructive reversals."
        actions={
          hasPermission(Permission.FEE_COLLECT, Permission.FEE_ADJUST) ? (
            <button
              type="button"
              onClick={() => setAssessModal(true)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md whitespace-nowrap"
            >
              Assess Student Fee
            </button>
          ) : undefined
        }
      />

      <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit no-print">
        <button
          type="button"
          onClick={() => setTab('ledger')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-md ${
            tab === 'ledger' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          Fee Assessments & Balances ({ledgerQuery.data?.assessments.length || 0})
        </button>
        <button
          type="button"
          onClick={() => setTab('receipts')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-md ${
            tab === 'receipts' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          Posted Payments & Receipts ({ledgerQuery.data?.payments.length || 0})
        </button>
      </div>

      {ledgerQuery.isLoading ? (
        <LoadingRows />
      ) : ledgerQuery.isError ? (
        <ErrorBanner message="Failed to load fee ledger" onRetry={() => void ledgerQuery.refetch()} />
      ) : tab === 'ledger' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto no-print">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Assessment & Due Date</th>
                <th className="py-3 px-4 text-right">Gross</th>
                <th className="py-3 px-4 text-right">Discount / Adj</th>
                <th className="py-3 px-4 text-right">Paid</th>
                <th className="py-3 px-4 text-right">Balance</th>
                <th className="py-3 px-4">Status</th>
                {hasPermission(Permission.FEE_COLLECT) && (
                  <th className="py-3 px-4 text-right">Collect</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {ledgerQuery.data?.assessments.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">{a.studentName}</div>
                    <div className="font-mono text-slate-500">{a.studentCode}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900">{a.title}</div>
                    <div className="text-slate-500 font-mono">Due: {a.dueDate}</div>
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">
                    {formatInrDisplay(a.grossAmountPaise)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                    -{formatInrDisplay(a.discountPaise)}{' '}
                    {a.adjustmentPaise !== 0 && `(+${formatInrDisplay(a.adjustmentPaise)})`}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700 font-medium">
                    {formatInrDisplay(a.effectivePaidPaise)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                    {formatInrDisplay(a.outstandingPaise)}
                  </td>
                  <td className="py-3 px-4">
                    <StatusText status={a.status} />
                  </td>
                  {hasPermission(Permission.FEE_COLLECT) && (
                    <td className="py-3 px-4 text-right">
                      {a.outstandingPaise > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const maxInr = a.outstandingPaise / 100;
                            setPaymentModal({
                              studentId: a.studentId,
                              studentName: a.studentName,
                              maxInr,
                            });
                            setPayForm((prev) => ({ ...prev, amountInr: String(maxInr) }));
                          }}
                          className="px-3 py-1 bg-slate-900 text-white font-semibold rounded whitespace-nowrap"
                        >
                          Collect Fee
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto no-print">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                <th className="py-3 px-4">Receipt No</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Method & Ref</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {ledgerQuery.data?.payments.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono font-bold text-slate-900">{p.receiptNumber}</td>
                  <td className="py-3 px-4 font-mono tabular-nums">{p.paymentDate}</td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">{p.studentName}</div>
                    <div className="font-mono text-slate-500">{p.studentCode}</div>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600">
                    {p.paymentMethod} {p.referenceNo ? `· ${p.referenceNo}` : ''}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                    {formatInrDisplay(p.amountPaise)}
                  </td>
                  <td className="py-3 px-4">
                    <StatusText status={p.status} />
                    {p.reversalReason && (
                      <div className="text-red-700 mt-0.5">{p.reversalReason}</div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setPrintReceipt(p)}
                      className="px-2.5 py-1 border border-slate-300 rounded hover:bg-slate-100"
                    >
                      Receipt
                    </button>
                    {p.status === 'POSTED' && hasPermission(Permission.FEE_ADJUST) && (
                      <button
                        type="button"
                        onClick={() => setReverseTarget(p)}
                        className="px-2.5 py-1 text-red-700 border border-red-200 rounded hover:bg-red-50"
                      >
                        Reverse
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Printable Official Fee Receipt View */}
      {printReceipt && (
        <div className="bg-white border-2 border-slate-900 rounded-lg p-6 space-y-4">
          <div className="flex items-start justify-between border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">NIKEN ACADEMY — Official Fee Receipt</h2>
              <p className="text-xs text-slate-600">
                {printReceipt.branchName} · {printReceipt.branchAddress} · {printReceipt.branchPhone}
              </p>
            </div>
            <div className="text-right font-mono text-xs">
              <div className="font-bold text-slate-900">{printReceipt.receiptNumber}</div>
              <div className="text-slate-600">Date: {printReceipt.paymentDate}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <div className="text-slate-500">Student Name</div>
              <div className="font-semibold text-slate-900">{printReceipt.studentName}</div>
            </div>
            <div>
              <div className="text-slate-500">Student ID</div>
              <div className="font-mono font-semibold text-slate-900">{printReceipt.studentCode}</div>
            </div>
            <div>
              <div className="text-slate-500">Payment Mode</div>
              <div className="font-mono text-slate-900">
                {printReceipt.paymentMethod} {printReceipt.referenceNo && `(${printReceipt.referenceNo})`}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Amount Received</div>
              <div className="text-base font-mono font-bold text-slate-900 tabular-nums">
                {formatInrDisplay(printReceipt.amountPaise)}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <span>Authorized Issuer: {printReceipt.issuerName}</span>
            <div className="flex items-center gap-2 no-print">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white font-semibold rounded"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Receipt</span>
              </button>
              <button
                type="button"
                onClick={() => setPrintReceipt(null)}
                className="px-3 py-1.5 border border-slate-300 rounded"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collect Payment Modal */}
      <ModalDialog
        open={Boolean(paymentModal)}
        title={`Collect Fee Payment — ${paymentModal?.studentName || ''}`}
        onClose={() => setPaymentModal(null)}
      >
        <form onSubmit={handleRecordPayment} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Amount Received (₹)</label>
              <input
                type="number"
                required
                min={1}
                step="0.01"
                value={payForm.amountInr}
                onChange={(e) => setPayForm({ ...payForm, amountInr: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Method</label>
              <select
                value={payForm.paymentMethod}
                onChange={(e) =>
                  setPayForm({
                    ...payForm,
                    paymentMethod: e.target.value as 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE',
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              >
                <option value="UPI">UPI</option>
                <option value="CASH">Cash</option>
                <option value="BANK_TRANSFER">Bank Transfer (NEFT/IMPS)</option>
                <option value="CHEQUE">Cheque</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">UTR / Cheque / Reference No</label>
              <input
                type="text"
                value={payForm.referenceNo}
                onChange={(e) => setPayForm({ ...payForm, referenceNo: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Date</label>
              <input
                type="date"
                required
                value={payForm.paymentDate}
                onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setPaymentModal(null)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Post Payment & Generate Receipt
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Create Assessment Modal */}
      <ModalDialog open={assessModal} title="Assess Student Fee Obligation" onClose={() => setAssessModal(false)}>
        <form onSubmit={handleCreateAssessment} className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Student</label>
            <select
              required
              value={assessForm.studentId}
              onChange={(e) => setAssessForm({ ...assessForm, studentId: e.target.value })}
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
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Fee Description</label>
            <input
              type="text"
              required
              value={assessForm.title}
              onChange={(e) => setAssessForm({ ...assessForm, title: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Gross Fee (₹)</label>
              <input
                type="number"
                required
                min={1}
                value={assessForm.grossAmountInr}
                onChange={(e) => setAssessForm({ ...assessForm, grossAmountInr: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Discount (₹)</label>
              <input
                type="number"
                min={0}
                value={assessForm.discountInr}
                onChange={(e) => setAssessForm({ ...assessForm, discountInr: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Due Date</label>
              <input
                type="date"
                required
                value={assessForm.dueDate}
                onChange={(e) => setAssessForm({ ...assessForm, dueDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setAssessModal(false)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Save Fee Assessment
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Controlled Payment Reversal Confirmation Dialog */}
      <ModalDialog
        open={Boolean(reverseTarget)}
        title={`Confirm Controlled Payment Reversal — ${reverseTarget?.receiptNumber || ''}`}
        onClose={() => setReverseTarget(null)}
      >
        <form onSubmit={handleReversePayment} className="space-y-4 text-sm">
          <p className="text-xs text-slate-600">
            IMS never deletes posted financial records. Reversing this receipt restores the student obligation and logs an immutable reversal entry in the audit log.
          </p>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Mandatory Reversal Reason</label>
            <input
              type="text"
              required
              minLength={5}
              placeholder="e.g., Cheque dishonored / Duplicate entry correction"
              value={reversalReason}
              onChange={(e) => setReversalReason(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setReverseTarget(null)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-red-700 text-white rounded-md">
              Confirm Reversal
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
