import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAppContext } from '../context/AppContext';
import { Permission, RoleCode } from '../shared/types';
import {
  PageHeader,
  LoadingRows,
  ErrorBanner,
  StatusText,
  ModalDialog,
} from '../components/UiPrimitives';

interface UserRecord {
  id: number;
  email: string;
  fullName: string;
  phone: string;
  branchId: number | null;
  branchName: string | null;
  roleCode: RoleCode;
  roleName: string;
  mfaEnabled: number;
  isActive: number;
  createdAt: string;
}

interface RoleRecord {
  id: number;
  code: RoleCode;
  name: string;
  description: string;
  permissions: Permission[];
}

interface AuditRecord {
  id: number;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  outcome: string;
  correlationId: string;
  createdAt: string;
}

export function AdministrationPage() {
  const { branches, selectedBranchId, hasPermission, refreshSession, notify } = useAppContext();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'branches' | 'users' | 'permissions' | 'audit'>('branches');

  const [branchModal, setBranchModal] = useState(false);
  const [branchForm, setBranchForm] = useState({
    code: '',
    name: '',
    city: 'Pune',
    address: '',
    phone: '',
    email: '',
  });

  const [userModal, setUserModal] = useState(false);
  const [userForm, setUserForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: 'Ims@2026!Secure',
    roleCode: RoleCode.BRANCH_ADMIN,
    branchId: branches[0]?.id ? String(branches[0].id) : '1',
  });

  const [auditSearch, setAuditSearch] = useState('');
  const [editingRole, setEditingRole] = useState<RoleCode>(RoleCode.BRANCH_ADMIN);
  const [draftPerms, setDraftPerms] = useState<Permission[]>([]);

  const usersQuery = useQuery({
    queryKey: ['admin-users', selectedBranchId],
    enabled: hasPermission(Permission.USER_MANAGE, Permission.ROLE_MANAGE),
    queryFn: () =>
      apiFetch<{ users: UserRecord[]; roles: RoleRecord[]; allPermissions: Permission[] }>(
        `/api/users?branchId=${encodeURIComponent(selectedBranchId)}`
      ),
  });

  const auditQuery = useQuery({
    queryKey: ['admin-audit', selectedBranchId, auditSearch],
    enabled: hasPermission(Permission.AUDIT_VIEW) && activeTab === 'audit',
    queryFn: () =>
      apiFetch<{ logs: AuditRecord[] }>(
        `/api/audit-logs?branchId=${encodeURIComponent(selectedBranchId)}&search=${encodeURIComponent(auditSearch)}`
      ),
  });

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/branches', { method: 'POST', body: branchForm });
      notify('success', `Branch ${branchForm.code.toUpperCase()} created.`);
      setBranchModal(false);
      setBranchForm({ code: '', name: '', city: 'Pune', address: '', phone: '', email: '' });
      await refreshSession();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to create branch');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/users', {
        method: 'POST',
        body: {
          ...userForm,
          branchId: userForm.branchId === 'NONE' ? null : Number(userForm.branchId),
        },
      });
      notify('success', `Staff account created for ${userForm.fullName}.`);
      setUserModal(false);
      await qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Could not create user');
    }
  };

  const handleToggleUserStatus = async (u: UserRecord) => {
    try {
      await apiFetch(`/api/users/${u.id}/status`, {
        method: 'PATCH',
        body: { isActive: !u.isActive },
      });
      notify('success', `${u.fullName} account ${u.isActive ? 'deactivated' : 'reactivated'}.`);
      await qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Update failed');
    }
  };

  const selectRoleForEdit = (roleCode: RoleCode, rolesList: RoleRecord[]) => {
    setEditingRole(roleCode);
    const found = rolesList.find((r) => r.code === roleCode);
    setDraftPerms(found ? [...found.permissions] : []);
  };

  const handleSaveRolePermissions = async () => {
    try {
      await apiFetch(`/api/roles/${editingRole}/permissions`, {
        method: 'PUT',
        body: { permissions: draftPerms },
      });
      notify('success', `Updated configurable permissions for ${editingRole}.`);
      await qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Could not update role permissions');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Administration, Branches & Access Governance"
        subtitle="Manage multi-branch campuses, staff accounts, configurable RBAC permission policies, and protected audit logs."
        actions={
          <div className="flex items-center gap-2">
            {hasPermission(Permission.BRANCH_MANAGE) && (
              <button
                type="button"
                onClick={() => setBranchModal(true)}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md whitespace-nowrap"
              >
                Add Campus Branch
              </button>
            )}
            {hasPermission(Permission.USER_MANAGE) && (
              <button
                type="button"
                onClick={() => setUserModal(true)}
                className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-900 text-xs font-semibold rounded-md whitespace-nowrap"
              >
                Provision Staff Account
              </button>
            )}
          </div>
        }
      />

      {/* Segmented Tab Bar */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('branches')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${
            activeTab === 'branches' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Campus Branches ({branches.length})
        </button>
        {hasPermission(Permission.USER_MANAGE, Permission.ROLE_MANAGE) && (
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${
              activeTab === 'users' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Staff & User Accounts
          </button>
        )}
        {hasPermission(Permission.ROLE_MANAGE) && (
          <button
            type="button"
            onClick={() => {
              setActiveTab('permissions');
              if (usersQuery.data?.roles) {
                selectRoleForEdit(editingRole, usersQuery.data.roles);
              }
            }}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${
              activeTab === 'permissions' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Role Permission Matrix
          </button>
        )}
        {hasPermission(Permission.AUDIT_VIEW) && (
          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${
              activeTab === 'audit' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Protected Audit Trail
          </button>
        )}
      </div>

      {activeTab === 'branches' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Campus Name</th>
                <th className="py-3 px-4">City & Address</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {branches.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900">{b.code}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900">{b.name}</td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    {b.city} — {b.address}
                  </td>
                  <td className="py-3 px-4 text-xs font-mono text-slate-600">
                    {b.phone} · {b.email}
                  </td>
                  <td className="py-3 px-4">
                    <StatusText status={b.isActive ? 'ACTIVE' : 'INACTIVE'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'users' && (
        <>
          {usersQuery.isLoading ? (
            <LoadingRows />
          ) : usersQuery.isError ? (
            <ErrorBanner message="Failed to load users" onRetry={() => void usersQuery.refetch()} />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Full Name</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Branch Scope</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {usersQuery.data?.users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-semibold text-slate-900">{u.fullName}</td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600">{u.email}</td>
                      <td className="py-3 px-4 text-xs text-slate-700">{u.roleName}</td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        {u.branchName || 'All Branches'}
                      </td>
                      <td className="py-3 px-4">
                        <StatusText status={u.isActive ? 'ACTIVE' : 'INACTIVE'} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        {hasPermission(Permission.USER_MANAGE) && (
                          <button
                            type="button"
                            onClick={() => void handleToggleUserStatus(u)}
                            className="px-2.5 py-1 text-xs font-medium border border-slate-300 rounded hover:bg-slate-100"
                          >
                            {u.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeTab === 'permissions' && usersQuery.data && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="flex items-center gap-3">
              <label htmlFor="role-select" className="text-xs font-semibold text-slate-700">
                Configure Role Policy:
              </label>
              <select
                id="role-select"
                value={editingRole}
                onChange={(e) => selectRoleForEdit(e.target.value as RoleCode, usersQuery.data.roles)}
                className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-md"
              >
                {usersQuery.data.roles
                  .filter((r) => r.code !== RoleCode.SUPER_ADMIN)
                  .map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name} ({r.code})
                    </option>
                  ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => void handleSaveRolePermissions()}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md"
            >
              Save Role Policy
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {usersQuery.data.allPermissions.map((perm) => {
              const checked = draftPerms.includes(perm);
              return (
                <label
                  key={perm}
                  className="flex items-center gap-2.5 p-2.5 border border-slate-200 rounded-md text-xs cursor-pointer hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      if (e.target.checked) setDraftPerms((p) => [...p, perm]);
                      else setDraftPerms((p) => p.filter((x) => x !== perm));
                    }}
                  />
                  <span className="font-mono text-slate-800">{perm}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="search"
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              placeholder="Filter audit trail by action, actor, or entity..."
              aria-label="Filter audit logs"
              className="px-3.5 py-2 text-xs bg-white border border-slate-300 rounded-md w-full max-w-md"
            />
          </div>
          {auditQuery.isLoading ? (
            <LoadingRows />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Target Entity</th>
                    <th className="py-3 px-4">Outcome</th>
                    <th className="py-3 px-4">Correlation ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {auditQuery.data?.logs.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600">
                        {l.createdAt.replace('T', ' ').slice(0, 19)}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-900">
                        {l.actorName} ({l.actorRole})
                      </td>
                      <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">{l.action}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-700">
                        {l.entityType} #{l.entityId}
                      </td>
                      <td className="py-2.5 px-4">
                        <StatusText status={l.outcome} />
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-500">{l.correlationId.slice(0, 12)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Create Branch Modal */}
      <ModalDialog open={branchModal} title="Add New Campus Branch" onClose={() => setBranchModal(false)}>
        <form onSubmit={handleCreateBranch} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Branch Code</label>
              <input
                type="text"
                required
                placeholder="PUN-AUN"
                value={branchForm.code}
                onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">City</label>
              <input
                type="text"
                required
                value={branchForm.city}
                onChange={(e) => setBranchForm({ ...branchForm, city: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Campus Name</label>
            <input
              type="text"
              required
              placeholder="NIKEN ACADEMY — Aundh Centre"
              value={branchForm.name}
              onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Full Address</label>
            <input
              type="text"
              required
              value={branchForm.address}
              onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Campus Phone</label>
              <input
                type="text"
                required
                value={branchForm.phone}
                onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Campus Email</label>
              <input
                type="email"
                required
                value={branchForm.email}
                onChange={(e) => setBranchForm({ ...branchForm, email: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setBranchModal(false)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Create Campus Branch
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Provision User Modal */}
      <ModalDialog open={userModal} title="Provision Staff User Account" onClose={() => setUserModal(false)}>
        <form onSubmit={handleCreateUser} className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
            <input
              type="text"
              required
              value={userForm.fullName}
              onChange={(e) => setUserForm({ ...userForm, fullName: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
              <input
                type="text"
                required
                value={userForm.phone}
                onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Role</label>
              <select
                value={userForm.roleCode}
                onChange={(e) => setUserForm({ ...userForm, roleCode: e.target.value as RoleCode })}
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              >
                <option value={RoleCode.BRANCH_ADMIN}>Branch Administrator</option>
                <option value={RoleCode.ACCOUNTANT}>Accountant</option>
                <option value={RoleCode.RECEPTIONIST}>Receptionist</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Campus Branch</label>
              <select
                value={userForm.branchId}
                onChange={(e) => setUserForm({ ...userForm, branchId: e.target.value })}
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
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Initial Temporary Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={userForm.password}
              onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setUserModal(false)} className="px-4 py-2 text-xs border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md">
              Create Staff Account
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
