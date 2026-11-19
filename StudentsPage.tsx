import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, Receipt, Calendar, UserPlus } from 'lucide-react';
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
  ModalDialog,
} from '../components/UiPrimitives';

interface StudentRow {
  id: number;
  studentCode: string;
  fullName: string;
  email: string;
  phone: string;
  academicLevel: string;
  admissionDate: string;
  branchId: number;
  branchName: string;
  status: string;
  outstandingPaise: number;
  hasOverdue: boolean;
  batches: Array<{ id: number; code: string; name: string }>;
  guardians: Array<{ fullName: string; phone: string; relationType: string }>;
}

export function StudentsPage() {
  const { branches, selectedBranchId, hasPermission, notify } = useAppContext();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [admitOpen, setAdmitOpen] = useState(false);

  useEffect(() => {
    const q = searchParams.get('search');
    if (q !== null) setSearch(q);
  }, [searchParams]);

  const defaultBranchId =
    selectedBranchId !== 'ALL' ? selectedBranchId : String(branches[0]?.id || 1);

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    academicLevel: 'Class 12 Science',
    admissionDate: new Date().toISOString().slice(0, 10),
    branchId: defaultBranchId,
    batchId: '',
    guardianName: '',
    guardianPhone: '',
    guardianEmail: '',
    guardianRelation: 'Father',
    // Declared Fee Structure at Admission
    admissionFeeInr: '10000',
    tuitionFeeInr: '45000',
    materialFeeInr: '5000',
    discountInr: '0',
    discountReason: '',
    installmentsCount: 1,
    feeDueDate: new Date().toISOString().slice(0, 10),
    initialPaymentInr: '20000',
    paymentMethod: 'UPI' as 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE',
    createPortalAccounts: false,
    portalPassword: 'Ims@2026!Secure',
    enquiryNotes: '',
  });

  const studentsQuery = useQuery({
    queryKey: ['students', selectedBranchId, search, statusFilter, page],
    queryFn: () =>
      apiFetch<{
        students: StudentRow[];
        pagination: { page: number; pageSize: number; total: number; totalPages: number };
      }>(
        `/api/students?branchId=${encodeURIComponent(selectedBranchId)}&search=${encodeURIComponent(search)}&status=${encodeURIComponent(statusFilter)}&page=${page}&pageSize=15`
      ),
  });

  const acadQuery = useQuery({
    queryKey: ['academics-batches-lookup', form.branchId],
    enabled: admitOpen && hasPermission(Permission.ACADEMIC_VIEW, Permission.STUDENT_MANAGE),
    queryFn: () =>
      apiFetch<{ batches: Array<{ id: number; code: string; name: string; branchId: number }> }>(
        `/api/academics/overview?branchId=${encodeURIComponent(form.branchId)}`
      ),
  });

  // Calculate live fee numbers for UI
  const admFee = Number(form.admissionFeeInr || 0);
  const tuiFee = Number(form.tuitionFeeInr || 0);
  const matFee = Number(form.materialFeeInr || 0);
  const grossFee = admFee + tuiFee + matFee;
  const discFee = Number(form.discountInr || 0);
  const netFee = Math.max(0, grossFee - discFee);
  const initialPay = Number(form.initialPaymentInr || 0);
  const remainingBal = Math.max(0, netFee - initialPay);

  const handleAdmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ studentCode: string; receiptNumber: string | null }>(
        '/api/students',
        {
          method: 'POST',
          body: {
            fullName: form.fullName,
            email: form.email,
            phone: form.phone,
            academicLevel: form.academicLevel,
            admissionDate: form.admissionDate,
            branchId: Number(form.branchId),
            batchId: form.batchId ? Number(form.batchId) : undefined,
            guardianName: form.guardianName || undefined,
            guardianPhone: form.guardianPhone || undefined,
            guardianEmail: form.guardianEmail || undefined,
            guardianRelation: form.guardianRelation,
            // Declared Fee Structure at Admission
            admissionFeeInr: admFee,
            tuitionFeeInr: tuiFee,
            materialFeeInr: matFee,
            discountInr: discFee,
            discountReason: form.discountReason || undefined,
            installmentsCount: Number(form.installmentsCount || 1),
            feeDueDate: form.feeDueDate,
            initialPaymentInr: initialPay,
            paymentMethod: form.paymentMethod,
            createPortalAccounts: form.createPortalAccounts,
            portalPassword: form.portalPassword,
            enquiryNotes: form.enquiryNotes,
          },
        }
      );
      notify(
        'success',
        `Admitted ${form.fullName} (${res.studentCode})${res.receiptNumber ? ` · Receipt ${res.receiptNumber} issued` : ''}`
      );
      setAdmitOpen(false);
      setForm((prev) => ({
        ...prev,
        fullName: '',
        email: '',
        phone: '',
        guardianName: '',
        guardianPhone: '',
        guardianEmail: '',
        enquiryNotes: '',
      }));
      await qc.invalidateQueries({ queryKey: ['students'] });
      await qc.invalidateQueries({ queryKey: ['fees'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Admission failed');
    }
  };

  const handleLifecycleChange = async (id: number, status: string) => {
    try {
      await apiFetch(`/api/students/${id}/lifecycle`, {
        method: 'PATCH',
        body: { status },
      });
      notify('success', `Student lifecycle status updated to ${status}.`);
      await qc.invalidateQueries({ queryKey: ['students'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Could not update status');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Student Admissions & Lifecycle"
        subtitle="Manage student registrations, declared fee structures, batch enrolments, guardian relationships, and ledger obligations."
        actions={
          hasPermission(Permission.STUDENT_MANAGE) ? (
            <button
              type="button"
              onClick={() => setAdmitOpen(true)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md whitespace-nowrap shadow-sm flex items-center gap-2"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>New Student Admission</span>
            </button>
          ) : undefined
        }
      />

      {/* Filters Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex items-center gap-2 flex-1 max-w-lg">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Student ID (STU-...), student name, or contact phone..."
            aria-label="Search students"
            className="px-3.5 py-2 text-xs bg-white border border-slate-300 rounded-md w-full focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="stu-status-filter" className="text-xs font-medium text-slate-600">
            Lifecycle:
          </label>
          <select
            id="stu-status-filter"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="SUSPENDED">SUSPENDED</option>
            <option value="WITHDRAWN">WITHDRAWN</option>
            <option value="COMPLETED">COMPLETED</option>
          </select>
        </div>
      </div>

      {studentsQuery.isLoading ? (
        <LoadingRows />
      ) : studentsQuery.isError ? (
        <ErrorBanner
          message="Failed to load student admissions"
          onRetry={() => void studentsQuery.refetch()}
        />
      ) : studentsQuery.data?.students.length === 0 ? (
        <EmptyState
          title="No student records found"
          description="Click 'New Student Admission' to admit students and declare their fee structure."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto shadow-sm">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Student ID</th>
                <th className="py-3 px-4">Student Name & Contact</th>
                <th className="py-3 px-4">Academic Level & Campus</th>
                <th className="py-3 px-4">Enrolled Batches</th>
                <th className="py-3 px-4">Guardian</th>
                <th className="py-3 px-4 text-right">Fee Status</th>
                <th className="py-3 px-4">Status</th>
                {hasPermission(Permission.STUDENT_MANAGE) && (
                  <th className="py-3 px-4 text-right">Lifecycle</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {studentsQuery.data?.students.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900">
                    {s.studentCode}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">{s.fullName}</div>
                    <div className="text-xs font-mono text-slate-500">
                      {s.phone} {s.email ? `· ${s.email}` : ''}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs">
                    <div className="font-medium text-slate-900">{s.academicLevel}</div>
                    <div className="text-slate-500 mt-0.5">{s.branchName}</div>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    {s.batches.length > 0
                      ? s.batches.map((b) => `${b.code} (${b.name})`).join(', ')
                      : 'Not enrolled'}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    {s.guardians.length > 0 ? (
                      <div>
                        <div className="font-medium text-slate-800">{s.guardians[0].fullName}</div>
                        <div className="text-slate-500 font-mono text-[11px]">
                          {s.guardians[0].relationType} · {s.guardians[0].phone}
                        </div>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-3 px-4 text-right text-xs font-mono tabular-nums">
                    {s.outstandingPaise > 0 ? (
                      <span className={s.hasOverdue ? 'text-rose-600 font-semibold' : 'text-amber-700 font-medium'}>
                        {formatInrDisplay(s.outstandingPaise)} due
                      </span>
                    ) : (
                      <span className="text-emerald-700 font-semibold">Clear</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <StatusText status={s.status} />
                  </td>
                  {hasPermission(Permission.STUDENT_MANAGE) && (
                    <td className="py-3 px-4 text-right">
                      <select
                        aria-label={`Update status for ${s.fullName}`}
                        value={s.status}
                        onChange={(e) => void handleLifecycleChange(s.id, e.target.value)}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white text-slate-700"
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="SUSPENDED">SUSPENDED</option>
                        <option value="WITHDRAWN">WITHDRAWN</option>
                        <option value="COMPLETED">COMPLETED</option>
                      </select>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination Footer */}
          {studentsQuery.data && (
            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
              <span className="tabular-nums">
                Showing page {studentsQuery.data.pagination.page} of{' '}
                {studentsQuery.data.pagination.totalPages} ({studentsQuery.data.pagination.total} total students)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 border border-slate-300 rounded disabled:opacity-40 hover:bg-slate-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= studentsQuery.data.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-2.5 py-1 border border-slate-300 rounded disabled:opacity-40 hover:bg-slate-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Complete Admission & Declared Fee Structure Workflow Modal */}
      <ModalDialog open={admitOpen} title="Student Admission & Fee Structure Declaration" onClose={() => setAdmitOpen(false)}>
        <form onSubmit={handleAdmit} className="space-y-4 text-sm max-h-[82vh] overflow-y-auto px-1">
          {/* Section 1: Basic Student Details */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-2">
              1. Student Academic Profile
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="stu-fullname" className="block text-xs font-semibold text-slate-700 mb-1">
                  Student Full Name *
                </label>
                <input
                  id="stu-fullname"
                  type="text"
                  required
                  placeholder="e.g. Aarav Sharma"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs"
                />
              </div>
              <div>
                <label htmlFor="stu-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                  Contact Phone *
                </label>
                <input
                  id="stu-phone"
                  type="text"
                  required
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+91-9822001122"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <div>
                <label htmlFor="stu-level" className="block text-xs font-semibold text-slate-700 mb-1">
                  Academic Level / Standard *
                </label>
                <input
                  id="stu-level"
                  type="text"
                  required
                  value={form.academicLevel}
                  onChange={(e) => setForm({ ...form, academicLevel: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs"
                />
              </div>
              <div>
                <label htmlFor="stu-branch" className="block text-xs font-semibold text-slate-700 mb-1">
                  Campus Branch *
                </label>
                <select
                  id="stu-branch"
                  value={form.branchId}
                  onChange={(e) => setForm({ ...form, branchId: e.target.value, batchId: '' })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs bg-white"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="stu-batch" className="block text-xs font-semibold text-slate-700 mb-1">
                  Enrol in Batch (Optional)
                </label>
                <select
                  id="stu-batch"
                  value={form.batchId}
                  onChange={(e) => setForm({ ...form, batchId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs bg-white"
                >
                  <option value="">Select Batch (Optional)</option>
                  {acadQuery.data?.batches.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Parent / Guardian Info */}
          <div className="pt-3 border-t border-slate-200">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-2">
              2. Parent / Guardian Details
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="stu-gname" className="block text-xs font-semibold text-slate-700 mb-1">
                  Guardian Name
                </label>
                <input
                  id="stu-gname"
                  type="text"
                  placeholder="e.g. Ramesh Sharma"
                  value={form.guardianName}
                  onChange={(e) => setForm({ ...form, guardianName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs"
                />
              </div>
              <div>
                <label htmlFor="stu-gphone" className="block text-xs font-semibold text-slate-700 mb-1">
                  Guardian Phone
                </label>
                <input
                  id="stu-gphone"
                  type="text"
                  placeholder="+91-9822003344"
                  value={form.guardianPhone}
                  onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs"
                />
              </div>
              <div>
                <label htmlFor="stu-grel" className="block text-xs font-semibold text-slate-700 mb-1">
                  Relationship
                </label>
                <select
                  id="stu-grel"
                  value={form.guardianRelation}
                  onChange={(e) => setForm({ ...form, guardianRelation: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs bg-white"
                >
                  <option value="Father">Father</option>
                  <option value="Mother">Mother</option>
                  <option value="Guardian">Legal Guardian</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 3: Declared Fee Structure at Admission */}
          <div className="pt-3 border-t border-slate-200">
            <div className="flex items-center gap-2 mb-2 text-slate-900">
              <CreditCard className="w-4 h-4 text-blue-600" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                3. Fee Structure Declared on Admission
              </h4>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Define the breakdown of fee heads, concessions, and installment frequency agreed during admission.
            </p>

            <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label htmlFor="stu-fee-adm" className="block text-xs font-semibold text-slate-700 mb-1">
                    Admission Fee (₹)
                  </label>
                  <input
                    id="stu-fee-adm"
                    type="number"
                    min="0"
                    value={form.admissionFeeInr}
                    onChange={(e) => setForm({ ...form, admissionFeeInr: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="stu-fee-tui" className="block text-xs font-semibold text-slate-700 mb-1">
                    Tuition / Course Fee (₹)
                  </label>
                  <input
                    id="stu-fee-tui"
                    type="number"
                    min="0"
                    value={form.tuitionFeeInr}
                    onChange={(e) => setForm({ ...form, tuitionFeeInr: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="stu-fee-mat" className="block text-xs font-semibold text-slate-700 mb-1">
                    Material / Lab (₹)
                  </label>
                  <input
                    id="stu-fee-mat"
                    type="number"
                    min="0"
                    value={form.materialFeeInr}
                    onChange={(e) => setForm({ ...form, materialFeeInr: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="stu-fee-disc" className="block text-xs font-semibold text-slate-700 mb-1">
                    Scholarship / Disc. (₹)
                  </label>
                  <input
                    id="stu-fee-disc"
                    type="number"
                    min="0"
                    value={form.discountInr}
                    onChange={(e) => setForm({ ...form, discountInr: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono"
                  />
                </div>
              </div>

              {/* Installments & Due Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label htmlFor="stu-fee-inst" className="block text-xs font-semibold text-slate-700 mb-1">
                    Payment Schedule (Installments)
                  </label>
                  <select
                    id="stu-fee-inst"
                    value={form.installmentsCount}
                    onChange={(e) => setForm({ ...form, installmentsCount: Number(e.target.value) })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white"
                  >
                    <option value={1}>Single Upfront Payment (1 Assessment)</option>
                    <option value={2}>2 Installments (30 days apart)</option>
                    <option value={3}>3 Installments (30 days apart)</option>
                    <option value={4}>4 Installments (30 days apart)</option>
                    <option value={6}>6 Installments (Bi-monthly / Monthly)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="stu-fee-due" className="block text-xs font-semibold text-slate-700 mb-1">
                    First Due Date
                  </label>
                  <input
                    id="stu-fee-due"
                    type="date"
                    value={form.feeDueDate}
                    onChange={(e) => setForm({ ...form, feeDueDate: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs"
                  />
                </div>
              </div>

              {/* Fee Summary Banner */}
              <div className="p-3 bg-white border border-slate-200 rounded-md flex items-center justify-between text-xs">
                <div>
                  <span className="text-slate-500">Gross Declared Fee:</span>{' '}
                  <span className="font-semibold text-slate-800">₹{grossFee.toLocaleString('en-IN')}</span>
                  {discFee > 0 && (
                    <span className="text-emerald-700 ml-2">
                      (Less Discount: -₹{discFee.toLocaleString('en-IN')})
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-slate-600 font-medium">Net Declared Payable:</span>{' '}
                  <span className="font-bold text-slate-900 text-sm">₹{netFee.toLocaleString('en-IN')}</span>
                  {form.installmentsCount > 1 && (
                    <div className="text-[11px] text-slate-500">
                      ~₹{Math.round(netFee / form.installmentsCount).toLocaleString('en-IN')} × {form.installmentsCount} instalments
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Initial Down Payment Collected at Desk */}
          <div className="pt-3 border-t border-slate-200">
            <div className="flex items-center gap-2 mb-2 text-slate-900">
              <Receipt className="w-4 h-4 text-emerald-600" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                4. Initial Payment Collected at Desk (Optional)
              </h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="stu-fee-paid" className="block text-xs font-semibold text-slate-700 mb-1">
                  Amount Received Now (₹)
                </label>
                <input
                  id="stu-fee-paid"
                  type="number"
                  min="0"
                  value={form.initialPaymentInr}
                  onChange={(e) => setForm({ ...form, initialPaymentInr: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs font-mono"
                />
              </div>
              <div>
                <label htmlFor="stu-pay-method" className="block text-xs font-semibold text-slate-700 mb-1">
                  Payment Mode
                </label>
                <select
                  id="stu-pay-method"
                  value={form.paymentMethod}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      paymentMethod: e.target.value as 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE',
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs bg-white"
                >
                  <option value="UPI">UPI / QR Code</option>
                  <option value="CASH">Cash</option>
                  <option value="BANK_TRANSFER">Bank Transfer (NEFT/IMPS)</option>
                  <option value="CHEQUE">Cheque / Demand Draft</option>
                </select>
              </div>
            </div>

            {initialPay > 0 && (
              <div className="mt-2 text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 p-2 rounded">
                Official institute receipt will be generated immediately for ₹{initialPay.toLocaleString('en-IN')} and allocated to the first installment. Remaining balance due: ₹{remainingBal.toLocaleString('en-IN')}.
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setAdmitOpen(false)}
              className="px-4 py-2 text-xs border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800 shadow-sm"
            >
              Complete Admission & Declare Fees
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
