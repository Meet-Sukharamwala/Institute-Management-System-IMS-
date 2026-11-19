import React, { useState } from 'react';
import { ShieldCheck, KeyRound } from 'lucide-react';
import { apiFetch, setStoredAuthTokens } from '../lib/api';
import { useAppContext } from '../context/AppContext';

export function LoginPage() {
  const { devSandbox, refreshSession, notify } = useAppContext();
  const [email, setEmail] = useState('director@nikenacademy.edu.in');
  const [password, setPassword] = useState(devSandbox?.passwordHint || 'Ims@2026!Secure');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [generatedResetToken, setGeneratedResetToken] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);
    try {
      const res = await apiFetch<{
        mfaRequired?: boolean;
        message?: string;
        sessionToken?: string;
        csrfToken?: string;
      }>('/api/auth/login', {
        method: 'POST',
        body: { email, password, mfaCode: mfaCode || undefined },
      });
      if (res.mfaRequired) {
        setMfaRequired(true);
        notify('info', res.message || 'Privileged MFA code required.');
      } else if (res.sessionToken) {
        setStoredAuthTokens(res.sessionToken, res.csrfToken || null);
        await refreshSession();
        notify('success', 'Signed in to Institute Management System.');
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const res = await apiFetch<{ message: string; devSandboxResetCode: string | null }>(
        '/api/auth/password-reset/request',
        { method: 'POST', body: { email: resetEmail } }
      );
      setGeneratedResetToken(res.devSandboxResetCode);
      notify('info', res.message);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Reset request failed.');
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: { email: resetEmail, resetCode, newPassword },
      });
      notify('success', res.message);
      setResetMode(false);
      setEmail(resetEmail);
      setPassword(newPassword);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not reset password.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Sign-In Form */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-8">
          <div className="flex items-center gap-2.5 text-slate-900">
            <ShieldCheck className="w-6 h-6 text-slate-900" />
            <span className="text-lg font-bold tracking-tight">NIKEN ACADEMY — IMS</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-4">
            {resetMode ? 'Account Password Recovery' : 'Sign in to Institute Operations'}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Role-based academic, attendance, financial, and campus portal access.
          </p>

          {errorMsg && (
            <div role="alert" className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 font-medium">
              {errorMsg}
            </div>
          )}

          {!resetMode ? (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 mb-1">
                  Institutional Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                />
              </div>

              <div>
                <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700 mb-1">
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                />
              </div>

              {mfaRequired && (
                <div>
                  <label htmlFor="login-mfa" className="block text-xs font-semibold text-slate-700 mb-1">
                    6-Digit Privileged MFA PIN
                  </label>
                  <input
                    id="login-mfa"
                    type="text"
                    inputMode="numeric"
                    required
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder="246810"
                    className="w-full px-3.5 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {submitting ? 'Verifying Credentials...' : mfaRequired ? 'Verify MFA & Sign In' : 'Sign In'}
              </button>

              <div className="pt-2 flex justify-between items-center text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setResetMode(true);
                    setResetEmail(email);
                  }}
                  className="text-slate-600 hover:text-slate-900 underline"
                >
                  Forgot password?
                </button>
                <span className="text-slate-500">Protected by Scrypt + Session RBAC</span>
              </div>
            </form>
          ) : (
            <div className="mt-6 space-y-5">
              <form onSubmit={handleRequestReset} className="space-y-3">
                <div>
                  <label htmlFor="reset-email" className="block text-xs font-semibold text-slate-700 mb-1">
                    Account Email
                  </label>
                  <input
                    id="reset-email"
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg"
                >
                  Generate Reset Code
                </button>
              </form>

              {generatedResetToken && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                  Development Mode (SMTP not configured): One-time reset token is{' '}
                  <strong className="font-mono">{generatedResetToken}</strong>
                </div>
              )}

              <form onSubmit={handleConfirmReset} className="space-y-3 pt-3 border-t border-slate-200">
                <div>
                  <label htmlFor="reset-code" className="block text-xs font-semibold text-slate-700 mb-1">
                    One-Time Reset Code
                  </label>
                  <input
                    id="reset-code"
                    type="text"
                    required
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="reset-new-pw" className="block text-xs font-semibold text-slate-700 mb-1">
                    New Password (min 8 characters)
                  </label>
                  <input
                    id="reset-new-pw"
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-emerald-700 text-white text-xs font-semibold rounded-lg"
                  >
                    Confirm New Password
                  </button>
                  <button
                    type="button"
                    onClick={() => setResetMode(false)}
                    className="px-3 py-2 text-xs text-slate-600 hover:text-slate-900"
                  >
                    Back to Sign In
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Right Role Switcher Quick-Fill (Development Mode Only) */}
        {devSandbox && (
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center gap-2 text-slate-900">
              <KeyRound className="w-4 h-4 text-slate-700" />
              <h2 className="text-base font-bold">Authorized Account Credentials</h2>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Select your Director account below to populate credentials. Log in to onboard faculty, admit students, create courses & batches, configure fee structures, and manage institute operations.
            </p>

            <div className="mt-4 divide-y divide-slate-200 border border-slate-200 rounded-lg">
              {devSandbox.accounts.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => {
                    setResetMode(false);
                    setMfaRequired(false);
                    setEmail(acc.email);
                    setPassword(devSandbox.passwordHint);
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-4 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">{acc.fullName}</div>
                    <div className="text-xs text-slate-500 font-mono truncate">{acc.email}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-semibold text-slate-800">{acc.roleCode.replace('_', ' ')}</div>
                    <div className="text-xs text-slate-500">{acc.branchName || 'All Branches'}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
