import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider, useAppContext } from './context/AppContext';
import { Permission } from './shared/types';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { AdministrationPage } from './pages/AdministrationPage';
import { StudentsPage } from './pages/StudentsPage';
import { TeachersPage } from './pages/TeachersPage';
import { AcademicsPage } from './pages/AcademicsPage';
import { TeachingRecordsPage } from './pages/TeachingRecordsPage';
import { AttendancePage } from './pages/AttendancePage';
import { EntryExitPage } from './pages/EntryExitPage';
import { TeacherVerificationPage } from './pages/TeacherVerificationPage';
import { FeesPage } from './pages/FeesPage';
import { PayrollPage } from './pages/PayrollPage';
import { LeavesPage } from './pages/LeavesPage';
import { ExaminationsPage } from './pages/ExaminationsPage';
import { HomeworkPage } from './pages/HomeworkPage';
import { PortalPage } from './pages/PortalPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ReportsPage, SettingsPage } from './pages/ReportsAndSettingsPages';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function GuardedRoute({
  allowed,
  fallbackTo,
  children,
}: {
  allowed: boolean;
  fallbackTo: string;
  children: React.ReactElement;
}) {
  if (!allowed) {
    return <Navigate to={fallbackTo} replace />;
  }
  return children;
}

function AuthenticatedRoutes() {
  const { user, loadingAuth, hasPermission } = useAppContext();

  React.useEffect(() => {
    if (!user) {
      queryClient.clear();
    }
  }, [user]);

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-600">
        Verifying institutional session...
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const canViewDashboard = hasPermission(Permission.DASHBOARD_VIEW);
  const homePath = canViewDashboard ? '/' : '/portal';

  return (
    <AppLayout>
      <Routes>
        <Route
          path="/"
          element={canViewDashboard ? <DashboardPage /> : <Navigate to="/portal" replace />}
        />
        <Route
          path="/portal"
          element={
            <GuardedRoute
              allowed={hasPermission(Permission.PORTAL_STUDENT, Permission.PORTAL_PARENT)}
              fallbackTo={homePath}
            >
              <PortalPage />
            </GuardedRoute>
          }
        />
        <Route
          path="/administration"
          element={
            <GuardedRoute
              allowed={hasPermission(
                Permission.BRANCH_MANAGE,
                Permission.USER_MANAGE,
                Permission.ROLE_MANAGE,
                Permission.AUDIT_VIEW
              )}
              fallbackTo={homePath}
            >
              <AdministrationPage />
            </GuardedRoute>
          }
        />
        <Route
          path="/students"
          element={
            <GuardedRoute allowed={hasPermission(Permission.STUDENT_VIEW)} fallbackTo={homePath}>
              <StudentsPage />
            </GuardedRoute>
          }
        />
        <Route
          path="/teachers"
          element={
            <GuardedRoute allowed={hasPermission(Permission.TEACHER_VIEW)} fallbackTo={homePath}>
              <TeachersPage />
            </GuardedRoute>
          }
        />
        <Route
          path="/academics"
          element={
            <GuardedRoute allowed={hasPermission(Permission.ACADEMIC_VIEW)} fallbackTo={homePath}>
              <AcademicsPage />
            </GuardedRoute>
          }
        />
        <Route
          path="/teaching-records"
          element={
            <GuardedRoute
              allowed={hasPermission(Permission.ACADEMIC_VIEW, Permission.TEACHING_RECORD_SUBMIT)}
              fallbackTo={homePath}
            >
              <TeachingRecordsPage />
            </GuardedRoute>
          }
        />
        <Route
          path="/attendance"
          element={
            <GuardedRoute
              allowed={hasPermission(Permission.ATTENDANCE_STUDENT_MARK, Permission.STUDENT_VIEW)}
              fallbackTo={homePath}
            >
              <AttendancePage />
            </GuardedRoute>
          }
        />
        <Route
          path="/entry-exit"
          element={
            <GuardedRoute allowed={hasPermission(Permission.MOVEMENT_RECORD)} fallbackTo={homePath}>
              <EntryExitPage />
            </GuardedRoute>
          }
        />
        <Route
          path="/teacher-verification"
          element={
            <GuardedRoute
              allowed={hasPermission(
                Permission.TEACHER_VERIFICATION_HOST,
                Permission.TEACHER_VERIFICATION_CHECKIN
              )}
              fallbackTo={homePath}
            >
              <TeacherVerificationPage />
            </GuardedRoute>
          }
        />
        <Route
          path="/fees"
          element={
            <GuardedRoute allowed={hasPermission(Permission.FEE_VIEW)} fallbackTo={homePath}>
              <FeesPage />
            </GuardedRoute>
          }
        />
        <Route
          path="/payroll"
          element={
            <GuardedRoute
              allowed={hasPermission(
                Permission.PAYROLL_CALCULATE,
                Permission.PAYROLL_APPROVE,
                Permission.PAYROLL_VIEW_OWN
              )}
              fallbackTo={homePath}
            >
              <PayrollPage />
            </GuardedRoute>
          }
        />
        <Route
          path="/leaves"
          element={
            <GuardedRoute
              allowed={hasPermission(Permission.LEAVE_REQUEST, Permission.LEAVE_APPROVE)}
              fallbackTo={homePath}
            >
              <LeavesPage />
            </GuardedRoute>
          }
        />
        <Route
          path="/examinations"
          element={
            <GuardedRoute allowed={hasPermission(Permission.EXAM_VIEW)} fallbackTo={homePath}>
              <ExaminationsPage />
            </GuardedRoute>
          }
        />
        <Route
          path="/homework"
          element={
            <GuardedRoute allowed={hasPermission(Permission.HOMEWORK_VIEW)} fallbackTo={homePath}>
              <HomeworkPage />
            </GuardedRoute>
          }
        />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route
          path="/reports"
          element={
            <GuardedRoute allowed={hasPermission(Permission.REPORT_VIEW)} fallbackTo={homePath}>
              <ReportsPage />
            </GuardedRoute>
          }
        />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to={homePath} replace />} />
      </Routes>
    </AppLayout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <BrowserRouter>
          <AuthenticatedRoutes />
        </BrowserRouter>
      </AppProvider>
    </QueryClientProvider>
  );
}
