import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ShieldCheck,
  GraduationCap,
  Users,
  BookOpen,
  ClipboardCheck,
  DoorOpen,
  IndianRupee,
  Wallet,
  CalendarOff,
  Award,
  FileText,
  Bell,
  BarChart3,
  Settings,
  Menu,
  X,
  LogOut,
  Search,
  UserCheck,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { Permission, RoleCode } from '../shared/types';

interface NavEntry {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permissions: Permission[];
}

const NAV_ITEMS: NavEntry[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, permissions: [Permission.DASHBOARD_VIEW] },
  {
    to: '/portal',
    label: 'My Portal',
    icon: GraduationCap,
    permissions: [Permission.PORTAL_STUDENT, Permission.PORTAL_PARENT],
  },
  {
    to: '/administration',
    label: 'Administration',
    icon: ShieldCheck,
    permissions: [Permission.BRANCH_MANAGE, Permission.USER_MANAGE, Permission.ROLE_MANAGE, Permission.AUDIT_VIEW],
  },
  {
    to: '/students',
    label: 'Students',
    icon: GraduationCap,
    permissions: [Permission.STUDENT_VIEW],
  },
  {
    to: '/teachers',
    label: 'Teachers & Staff',
    icon: Users,
    permissions: [Permission.TEACHER_VIEW],
  },
  {
    to: '/academics',
    label: 'Academics & Syllabus',
    icon: BookOpen,
    permissions: [Permission.ACADEMIC_VIEW],
  },
  {
    to: '/teaching-records',
    label: 'Daily Teaching Records',
    icon: FileText,
    permissions: [Permission.ACADEMIC_VIEW, Permission.TEACHING_RECORD_SUBMIT],
  },
  {
    to: '/attendance',
    label: 'Classroom Attendance',
    icon: ClipboardCheck,
    permissions: [Permission.ATTENDANCE_STUDENT_MARK, Permission.STUDENT_VIEW],
  },
  {
    to: '/entry-exit',
    label: 'Student Entry/Exit',
    icon: DoorOpen,
    permissions: [Permission.MOVEMENT_RECORD],
  },
  {
    to: '/teacher-verification',
    label: 'Teacher Verification',
    icon: UserCheck,
    permissions: [Permission.TEACHER_VERIFICATION_HOST, Permission.TEACHER_VERIFICATION_CHECKIN],
  },
  {
    to: '/fees',
    label: 'Fees & Payments',
    icon: IndianRupee,
    permissions: [Permission.FEE_VIEW],
  },
  {
    to: '/payroll',
    label: 'Salary & Payroll',
    icon: Wallet,
    permissions: [Permission.PAYROLL_CALCULATE, Permission.PAYROLL_APPROVE, Permission.PAYROLL_VIEW_OWN],
  },
  {
    to: '/leaves',
    label: 'Leave Management',
    icon: CalendarOff,
    permissions: [Permission.LEAVE_REQUEST, Permission.LEAVE_APPROVE],
  },
  {
    to: '/examinations',
    label: 'Examinations',
    icon: Award,
    permissions: [Permission.EXAM_VIEW],
  },
  {
    to: '/homework',
    label: 'Homework',
    icon: FileText,
    permissions: [Permission.HOMEWORK_VIEW],
  },
  {
    to: '/notifications',
    label: 'Notifications',
    icon: Bell,
    permissions: Object.values(Permission),
  },
  {
    to: '/reports',
    label: 'Reports & Analytics',
    icon: BarChart3,
    permissions: [Permission.REPORT_VIEW],
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: Settings,
    permissions: Object.values(Permission),
  },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const {
    user,
    branches,
    selectedBranchId,
    setSelectedBranchId,
    hasPermission,
    logout,
  } = useAppContext();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  if (!user) return <>{children}</>;

  const visibleNav = NAV_ITEMS.filter((item) => {
    if (
      item.to === '/portal' &&
      user.roleCode !== RoleCode.STUDENT &&
      user.roleCode !== RoleCode.PARENT
    ) {
      return false;
    }
    return hasPermission(...item.permissions);
  });

  const activeItem =
    visibleNav.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to))) ||
    visibleNav[0];

  const canSwitchBranch =
    user.roleCode === RoleCode.SUPER_ADMIN || hasPermission(Permission.BRANCH_SWITCH);

  const handleGlobalSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = globalQuery.trim();
    if (!q) return;
    if (hasPermission(Permission.STUDENT_VIEW)) {
      navigate(`/students?search=${encodeURIComponent(q)}`);
      setGlobalQuery('');
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-r border-slate-200 no-print">
        <div className="h-14 px-5 flex items-center border-b border-slate-200">
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            NIKEN ACADEMY
          </span>
        </div>
        <nav aria-label="Primary Sidebar" className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-200 text-xs text-slate-600">
          <div className="font-semibold text-slate-900 truncate">{user.fullName}</div>
          <div className="mt-0.5 truncate">
            {user.roleName} · {user.branchName || 'All Campuses'}
          </div>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="fixed inset-0 bg-slate-900/50" onClick={() => setDrawerOpen(false)} />
          <aside className="relative z-10 w-72 max-w-[82vw] bg-white h-full flex flex-col border-r border-slate-200">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200">
              <span className="text-base font-bold text-slate-900">NIKEN ACADEMY</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 text-slate-600 hover:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-1">
              {visibleNav.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setDrawerOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium ${
                        isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar (Contextual Breadcrumb + Search/Branch/Actions) */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-30 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-2 text-slate-700 hover:text-slate-900"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm text-slate-600 truncate">
              <span className="hidden sm:inline">IMS</span>
              <span className="hidden sm:inline mx-2 text-slate-400">/</span>
              <span className="font-semibold text-slate-900">{activeItem?.label || 'Workspace'}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {hasPermission(Permission.STUDENT_VIEW) && (
              <form onSubmit={handleGlobalSearch} className="hidden md:flex items-center relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
                <input
                  type="search"
                  value={globalQuery}
                  onChange={(e) => setGlobalQuery(e.target.value)}
                  placeholder="Find student ID or name..."
                  aria-label="Global student search"
                  className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md w-52 focus:outline-none focus:border-slate-900"
                />
              </form>
            )}

            {canSwitchBranch ? (
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="sr-only">Active Branch Filter</span>
                <select
                  aria-label="Select Campus Branch"
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-slate-900 max-w-52 truncate"
                >
                  <option value="ALL">All Branches ({branches.length})</option>
                  {branches.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="hidden sm:inline text-xs text-slate-600 whitespace-nowrap">
                {user.branchName || 'Assigned Campus'}
              </span>
            )}

            <button
              type="button"
              onClick={() => navigate('/notifications')}
              aria-label="Open Notification Center"
              className="p-2 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100"
            >
              <Bell className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => {
                void logout().then(() => navigate('/', { replace: true }));
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
