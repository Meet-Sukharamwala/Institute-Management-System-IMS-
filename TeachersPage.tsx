import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, ShieldCheck } from 'lucide-react';
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

interface TeacherRow {
  id: number;
  employeeCode: string;
  fullName: string;
  email: string;
  phone: string;
  designation: string;
  employmentType: string;
  joiningDate: string;
  primaryBranchName: string;
  subjectsCsv: string;
  salaryStructureId?: number | null;
  salaryStructureName?: string;
  salaryModel?: string;
  baseSalaryPaise?: number;
  perLectureRatePaise?: number;
  hourlyRatePaise?: number;
  allowancesPaise?: number;
  statutoryDeductionPaise?: number;
  deductUnpaidLeave?: number;
  status: string;
  assignedBranches: Array<{ id: number; code: string; name: string }>;
  assignedBatches: Array<{ id: number; code: string; name: string; subjectName: string }>;
}

export function TeachersPage() {
  const { branches, selectedBranchId, hasPermission, notify } = useAppContext();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editSalaryTeacher, setEditSalaryTeacher] = useState<TeacherRow | null>(null);

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    designation: 'Senior Faculty',
    employmentType: 'FULL_TIME' as 'FULL_TIME' | 'PART_TIME' | 'VISITING' | 'CONTRACT',
    joiningDate: new Date().toISOString().slice(0, 10),
    primaryBranchId: selectedBranchId !== 'ALL' ? selectedBranchId : String(branches[0]?.id || 1),
    subjectsCsv: 'Physics',
    // Dynamic Custom Salary Structure entered at onboarding
    salaryModel: 'FIXED_MONTHLY' as 'FIXED_MONTHLY' | 'PER_LECTURE' | 'HOURLY',
    baseSalaryInr: '65000',
    perLectureRateInr: '1500',
    hourlyRateInr: '0',
    allowancesInr: '5000',
    statutoryDeductionInr: '2000',
    deductUnpaidLeave: true,
    documentsNotes: 'Degree & ID Verified',
  });

  const [editSalaryForm, setEditSalaryForm] = useState({
    salaryModel: 'FIXED_MONTHLY' as 'FIXED_MONTHLY' | 'PER_LECTURE' | 'HOURLY',
    baseSalaryInr: '65000',
    perLectureRateInr: '1500',
    hourlyRateInr: '0',
    allowancesInr: '5000',
    statutoryDeductionInr: '2000',
    deductUnpaidLeave: true,
  });

  const query = useQuery({
    queryKey: ['teachers', selectedBranchId, search],
    queryFn: () =>
      apiFetch<{
        teachers: TeacherRow[];
        salaryStructures: Array<{ id: number; name: string; model: string }>;
      }>(
        `/api/teachers?branchId=${encodeURIComponent(selectedBranchId)}&search=${encodeURIComponent(search)}`
      ),
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ employeeCode: string }>('/api/teachers', {
        method: 'POST',
        body: {
          fullName: form.fullName,
          email: form.email,
          phone: form.phone,
          designation: form.designation,
          employmentType: form.employmentType,
          joiningDate: form.joiningDate,
          primaryBranchId: Number(form.primaryBranchId),
          subjectsCsv: form.subjectsCsv,
          documentsNotes: form.documentsNotes,
          // Custom salary structure declared at onboarding
          salaryModel: form.salaryModel,
          baseSalaryInr: Number(form.baseSalaryInr || 0),
          perLectureRateInr: Number(form.perLectureRateInr || 0),
          hourlyRateInr: Number(form.hourlyRateInr || 0),
          allowancesInr: Number(form.allowancesInr || 0),
          statutoryDeductionInr: Number(form.statutoryDeductionInr || 0),
          deductUnpaidLeave: form.deductUnpaidLeave,
        },
      });
      notify('success', `Faculty onboarded (${res.employeeCode}) with declared salary structure.`);
      setModalOpen(false);
      setForm((prev) => ({
        ...prev,
        fullName: '',
        email: '',
        phone: '',
        subjectsCsv: 'Physics',
      }));
      await qc.invalidateQueries({ queryKey: ['teachers'] });
      await qc.invalidateQueries({ queryKey: ['payroll'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to create faculty record');
    }
  };

  const handleStatusChange = async (id: number, status: string) => {
    try {
      await apiFetch(`/api/teachers/${id}/status`, {
        method: 'PATCH',
        body: { status },
      });
      notify('success', `Faculty status updated to ${status}.`);
      await qc.invalidateQueries({ queryKey: ['teachers'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Status update failed');
    }
  };

  const openSalaryEdit = (t: TeacherRow) => {
    setEditSalaryTeacher(t);
    setEditSalaryForm({
      salaryModel: (t.salaryModel as 'FIXED_MONTHLY' | 'PER_LECTURE' | 'HOURLY') || 'FIXED_MONTHLY',
      baseSalaryInr: String(t.baseSalaryPaise ? Math.round(t.baseSalaryPaise / 100) : 0),
      perLectureRateInr: String(t.perLectureRatePaise ? Math.round(t.perLectureRatePaise / 100) : 0),
      hourlyRateInr: String(t.hourlyRatePaise ? Math.round(t.hourlyRatePaise / 100) : 0),
      allowancesInr: String(t.allowancesPaise ? Math.round(t.allowancesPaise / 100) : 0),
      statutoryDeductionInr: String(t.statutoryDeductionPaise ? Math.round(t.statutoryDeductionPaise / 100) : 0),
      deductUnpaidLeave: t.deductUnpaidLeave !== 0,
    });
  };

  const handleUpdateSalary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editSalaryTeacher) return;
    try {
      await apiFetch(`/api/teachers/${editSalaryTeacher.id}/salary-structure`, {
        method: 'PATCH',
        body: {
          salaryModel: editSalaryForm.salaryModel,
          baseSalaryInr: Number(editSalaryForm.baseSalaryInr || 0),
          perLectureRateInr: Number(editSalaryForm.perLectureRateInr || 0),
          hourlyRateInr: Number(editSalaryForm.hourlyRateInr || 0),
          allowancesInr: Number(editSalaryForm.allowancesInr || 0),
          statutoryDeductionInr: Number(editSalaryForm.statutoryDeductionInr || 0),
          deductUnpaidLeave: editSalaryForm.deductUnpaidLeave,
        },
      });
      notify('success', `Salary structure updated for ${editSalaryTeacher.fullName}.`);
      setEditSalaryTeacher(null);
      await qc.invalidateQueries({ queryKey: ['teachers'] });
      await qc.invalidateQueries({ queryKey: ['payroll'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to update salary structure');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teachers & Faculty Directory"
        subtitle="Manage faculty profiles, custom compensation structures entered on onboarding, branch assignments, and teaching batches."
        actions={
          hasPermission(Permission.TEACHER_MANAGE) ? (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md whitespace-nowrap shadow-sm"
            >
              Onboard Faculty
            </button>
          ) : undefined
        }
      />

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by Employee ID (EMP-...), faculty name, or subject..."
        aria-label="Search faculty"
        className="px-3.5 py-2 text-xs bg-white border border-slate-300 rounded-md w-full max-w-md focus:outline-none focus:ring-1 focus:ring-slate-900"
      />

      {query.isLoading ? (
        <LoadingRows />
      ) : query.isError ? (
        <ErrorBanner message="Failed to load faculty directory" onRetry={() => void query.refetch()} />
      ) : query.data?.teachers.length === 0 ? (
        <EmptyState
          title="No faculty members found"
          description="Click 'Onboard Faculty' to register teachers and define their personalized salary structure."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto shadow-sm">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Emp ID</th>
                <th className="py-3 px-4">Faculty Name & Contact</th>
                <th className="py-3 px-4">Designation & Subjects</th>
                <th className="py-3 px-4">Assigned Branches & Batches</th>
                {hasPermission(Permission.PAYROLL_CALCULATE, Permission.PAYROLL_APPROVE) && (
                  <th className="py-3 px-4 text-right">Compensation Structure</th>
                )}
                <th className="py-3 px-4">Status</th>
                {hasPermission(Permission.TEACHER_MANAGE) && (
                  <th className="py-3 px-4 text-right">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {query.data?.teachers.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900">
                    {t.employeeCode}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">{t.fullName}</div>
                    <div className="text-xs font-mono text-slate-500">
                      {t.email} · {t.phone}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700">
                    <div className="font-medium text-slate-900">
                      {t.designation} ({t.employmentType.replace('_', ' ')})
                    </div>
                    <div className="text-slate-600 mt-0.5">{t.subjectsCsv}</div>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    <div>{t.assignedBranches.map((b) => b.code).join(' · ')}</div>
                    <div className="text-slate-500 mt-0.5">
                      {t.assignedBatches.length > 0
                        ? t.assignedBatches.map((b) => `${b.code} (${b.subjectName})`).join(' · ')
                        : 'No batches assigned'}
                    </div>
                  </td>
                  {hasPermission(Permission.PAYROLL_CALCULATE, Permission.PAYROLL_APPROVE) && (
                    <td className="py-3 px-4 text-right text-xs">
                      <div className="font-semibold text-slate-900">
                        {t.salaryModel === 'FIXED_MONTHLY' ? (
                          <span>{formatInrDisplay(t.baseSalaryPaise || 0)} / mo</span>
                        ) : t.salaryModel === 'PER_LECTURE' ? (
                          <span>{formatInrDisplay(t.perLectureRatePaise || 0)} / lecture</span>
                        ) : t.salaryModel === 'HOURLY' ? (
                          <span>{formatInrDisplay(t.hourlyRatePaise || 0)} / hour</span>
                        ) : (
                          'Not Declared'
                        )}
                      </div>
                      <div className="text-slate-500 text-[11px] truncate max-w-[200px] ml-auto">
                        {t.salaryStructureName || 'Personalized'}
                      </div>
                      {hasPermission(Permission.PAYROLL_APPROVE) && (
                        <button
                          type="button"
                          onClick={() => openSalaryEdit(t)}
                          className="text-[11px] text-blue-600 hover:text-blue-800 font-medium underline mt-0.5"
                        >
                          Edit Structure
                        </button>
                      )}
                    </td>
                  )}
                  <td className="py-3 px-4">
                    <StatusText status={t.status} />
                  </td>
                  {hasPermission(Permission.TEACHER_MANAGE) && (
                    <td className="py-3 px-4 text-right">
                      <select
                        aria-label={`Change employment status for ${t.fullName}`}
                        value={t.status}
                        onChange={(e) => void handleStatusChange(t.id, e.target.value)}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white text-slate-700"
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="ON_LEAVE">ON LEAVE</option>
                        <option value="INACTIVE">INACTIVE</option>
                      </select>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Faculty Onboarding Modal with Custom Salary Structure */}
      <ModalDialog open={modalOpen} title="Onboard Faculty Member & Configure Compensation" onClose={() => setModalOpen(false)}>
        <form onSubmit={handleCreate} className="space-y-4 text-sm max-h-[80vh] overflow-y-auto px-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Dr. Rajesh Kulkarni"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Designation *</label>
              <input
                type="text"
                required
                placeholder="e.g. Senior Faculty - Physics"
                value={form.designation}
                onChange={(e) => setForm({ ...form, designation: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Institutional Email *</label>
              <input
                type="email"
                required
                placeholder="faculty@nikenacademy.edu.in"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Phone *</label>
              <input
                type="text"
                required
                placeholder="+91-9876543210"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Employment Type</label>
              <select
                value={form.employmentType}
                onChange={(e) =>
                  setForm({
                    ...form,
                    employmentType: e.target.value as 'FULL_TIME' | 'PART_TIME' | 'VISITING' | 'CONTRACT',
                    salaryModel: e.target.value === 'VISITING' ? 'PER_LECTURE' : 'FIXED_MONTHLY',
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs bg-white"
              >
                <option value="FULL_TIME">Full Time</option>
                <option value="VISITING">Visiting Specialist</option>
                <option value="PART_TIME">Part Time</option>
                <option value="CONTRACT">Contract</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Primary Campus</label>
              <select
                value={form.primaryBranchId}
                onChange={(e) => setForm({ ...form, primaryBranchId: e.target.value })}
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
              <label className="block text-xs font-semibold text-slate-700 mb-1">Teaching Subjects *</label>
              <input
                type="text"
                required
                placeholder="e.g. Physics, Mechanics"
                value={form.subjectsCsv}
                onChange={(e) => setForm({ ...form, subjectsCsv: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs"
              />
            </div>
          </div>

          {/* DEDICATED SALARY STRUCTURE SECTION ENTERED AT ONBOARDING */}
          <div className="pt-3 border-t border-slate-200">
            <div className="flex items-center gap-2 mb-2 text-slate-900">
              <Banknote className="w-4 h-4 text-emerald-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Faculty Salary Structure (Entered for this faculty)
              </h3>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Each faculty member has a tailored compensation model calculated automatically during monthly payroll.
            </p>

            <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Compensation Model</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <label className={`flex items-center gap-2 p-2 rounded border text-xs cursor-pointer ${form.salaryModel === 'FIXED_MONTHLY' ? 'bg-slate-900 text-white border-slate-900 font-semibold' : 'bg-white border-slate-200 text-slate-700'}`}>
                    <input
                      type="radio"
                      name="onboard-model"
                      checked={form.salaryModel === 'FIXED_MONTHLY'}
                      onChange={() => setForm({ ...form, salaryModel: 'FIXED_MONTHLY' })}
                      className="sr-only"
                    />
                    <span>Fixed Monthly</span>
                  </label>
                  <label className={`flex items-center gap-2 p-2 rounded border text-xs cursor-pointer ${form.salaryModel === 'PER_LECTURE' ? 'bg-slate-900 text-white border-slate-900 font-semibold' : 'bg-white border-slate-200 text-slate-700'}`}>
                    <input
                      type="radio"
                      name="onboard-model"
                      checked={form.salaryModel === 'PER_LECTURE'}
                      onChange={() => setForm({ ...form, salaryModel: 'PER_LECTURE' })}
                      className="sr-only"
                    />
                    <span>Per-Lecture Visiting</span>
                  </label>
                  <label className={`flex items-center gap-2 p-2 rounded border text-xs cursor-pointer ${form.salaryModel === 'HOURLY' ? 'bg-slate-900 text-white border-slate-900 font-semibold' : 'bg-white border-slate-200 text-slate-700'}`}>
                    <input
                      type="radio"
                      name="onboard-model"
                      checked={form.salaryModel === 'HOURLY'}
                      onChange={() => setForm({ ...form, salaryModel: 'HOURLY' })}
                      className="sr-only"
                    />
                    <span>Hourly Rate</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {form.salaryModel === 'FIXED_MONTHLY' ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Base Monthly Salary (₹) *</label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={form.baseSalaryInr}
                      onChange={(e) => setForm({ ...form, baseSalaryInr: e.target.value })}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono"
                    />
                  </div>
                ) : form.salaryModel === 'PER_LECTURE' ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Rate Per Lecture (₹) *</label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={form.perLectureRateInr}
                      onChange={(e) => setForm({ ...form, perLectureRateInr: e.target.value })}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Hourly Rate (₹) *</label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={form.hourlyRateInr}
                      onChange={(e) => setForm({ ...form, hourlyRateInr: e.target.value })}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Monthly Allowances (₹)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.allowancesInr}
                    onChange={(e) => setForm({ ...form, allowancesInr: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Statutory Deductions (₹)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.statutoryDeductionInr}
                    onChange={(e) => setForm({ ...form, statutoryDeductionInr: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono"
                  />
                </div>
              </div>

              {form.salaryModel === 'FIXED_MONTHLY' && (
                <div className="flex items-center gap-2 pt-1 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    id="deduct-leave"
                    checked={form.deductUnpaidLeave}
                    onChange={(e) => setForm({ ...form, deductUnpaidLeave: e.target.checked })}
                    className="rounded border-slate-300 text-slate-900 focus:ring-0"
                  />
                  <label htmlFor="deduct-leave" className="cursor-pointer">
                    Deduct for unapproved / unpaid leave days proportional to monthly working days
                  </label>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 text-xs border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800 shadow-sm"
            >
              Onboard Faculty & Save Structure
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Edit Existing Faculty Salary Structure Modal */}
      {editSalaryTeacher && (
        <ModalDialog
          open={Boolean(editSalaryTeacher)}
          title={`Update Salary Structure — ${editSalaryTeacher.fullName}`}
          onClose={() => setEditSalaryTeacher(null)}
        >
          <form onSubmit={handleUpdateSalary} className="space-y-4 text-sm">
            <p className="text-xs text-slate-600">
              Update the personalized compensation parameters for {editSalaryTeacher.fullName} ({editSalaryTeacher.employeeCode}).
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Compensation Model</label>
              <div className="grid grid-cols-3 gap-2">
                {(['FIXED_MONTHLY', 'PER_LECTURE', 'HOURLY'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setEditSalaryForm({ ...editSalaryForm, salaryModel: m })}
                    className={`py-2 px-3 text-xs rounded border text-center font-medium ${editSalaryForm.salaryModel === m ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-700'}`}
                  >
                    {m === 'FIXED_MONTHLY' ? 'Fixed Monthly' : m === 'PER_LECTURE' ? 'Per-Lecture' : 'Hourly'}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {editSalaryForm.salaryModel === 'FIXED_MONTHLY' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Base Monthly (₹)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={editSalaryForm.baseSalaryInr}
                    onChange={(e) => setEditSalaryForm({ ...editSalaryForm, baseSalaryInr: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono"
                  />
                </div>
              ) : editSalaryForm.salaryModel === 'PER_LECTURE' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Rate Per Lecture (₹)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={editSalaryForm.perLectureRateInr}
                    onChange={(e) => setEditSalaryForm({ ...editSalaryForm, perLectureRateInr: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Hourly Rate (₹)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={editSalaryForm.hourlyRateInr}
                    onChange={(e) => setEditSalaryForm({ ...editSalaryForm, hourlyRateInr: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Allowances (₹)</label>
                <input
                  type="number"
                  min="0"
                  value={editSalaryForm.allowancesInr}
                  onChange={(e) => setEditSalaryForm({ ...editSalaryForm, allowancesInr: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Deductions (₹)</label>
                <input
                  type="number"
                  min="0"
                  value={editSalaryForm.statutoryDeductionInr}
                  onChange={(e) => setEditSalaryForm({ ...editSalaryForm, statutoryDeductionInr: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setEditSalaryTeacher(null)}
                className="px-4 py-2 text-xs border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800"
              >
                Save Compensation Changes
              </button>
            </div>
          </form>
        </ModalDialog>
      )}
    </div>
  );
}
