import React, { useState } from 'react';
import { Activity, ArrowRight, Lock, Mail, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../engine/types';

const DEMO_ROLES: Array<{ email: string; role: UserRole; label: string; scope: string }> = [
  { email: 'admin@stockmind.ai', role: 'Admin', label: 'Factory Director', scope: 'Full RBAC & approvals' },
  { email: 'inventory@stockmind.ai', role: 'Inventory Manager', label: 'Inventory Manager', scope: 'Risk & recovery decisions' },
  { email: 'procurement@stockmind.ai', role: 'Procurement Officer', label: 'Procurement Officer', scope: 'POs & supplier lead times' },
  { email: 'warehouse@stockmind.ai', role: 'Warehouse Manager', label: 'Warehouse Manager', scope: 'Stock movements & transfers' },
  { email: 'planner@stockmind.ai', role: 'Production Planner', label: 'Production Planner', scope: 'BOM matching & forecasts' },
];

export function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('admin@stockmind.ai');
  const [password, setPassword] = useState('StockMind2026!');
  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState('Knitwear Operations');
  const [roleName, setRoleName] = useState<UserRole>('Inventory Manager');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register({ fullName, email, password, roleName, department });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const quickDemoLogin = async (demoEmail: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await login(demoEmail, 'StockMind2026!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {/* Left Context Panel */}
        <div className="lg:col-span-6 p-8 sm:p-10 bg-slate-900 text-white flex flex-col justify-between gap-8">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
                <Activity className="w-5 h-5" />
              </div>
              <span className="font-display font-bold text-lg tracking-tight">StockMind AI</span>
            </div>

            <div className="space-y-3">
              <h1 className="font-display text-2xl sm:text-3xl font-bold leading-tight text-balance">
                Manufacturing Inventory Intelligence & Dead Stock Recovery
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed">
                Predict the Problem. Find the Alternative. Recover the Value. Built for garments
                and knitwear manufacturers to detect inventory risk, match compatible fabrics, and
                recover blocked working capital.
              </p>
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-800 text-xs text-slate-300">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <span>
                  Multi-factor Dead Stock & Anomaly Detection considering BOM commitments and
                  seasonal calendars.
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <span>
                  Hybrid KNN Material Compatibility Engine with mandatory QC approval workflow.
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <span>
                  4-Strategy Recovery Engine & Financial What-If Simulator separating estimated vs
                  realized savings.
                </span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 text-xs text-slate-400 leading-relaxed">
            Pre-loaded environment uses a reproducible <strong className="text-slate-200">synthetic knitwear & textile dataset</strong> (26 SKUs, 4 warehouses, 14-month snapshot history) for testing and evaluation.
          </div>
        </div>

        {/* Right Form & Role Access Panel */}
        <div className="lg:col-span-6 p-8 sm:p-10 space-y-6">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
            <h2 className="font-display text-xl font-semibold">
              {mode === 'login' ? 'Sign in to Workspace' : 'Create Factory Account'}
            </h2>
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === 'login'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === 'register'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Register
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label htmlFor="auth-fullname" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      id="auth-fullname"
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Ayesha Siddiqua"
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="auth-role" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Operational Role
                    </label>
                    <select
                      id="auth-role"
                      value={roleName}
                      onChange={(e) => setRoleName(e.target.value as UserRole)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      <option value="Inventory Manager">Inventory Manager</option>
                      <option value="Procurement Officer">Procurement Officer</option>
                      <option value="Warehouse Manager">Warehouse Manager</option>
                      <option value="Production Planner">Production Planner</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="auth-dept" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Department
                    </label>
                    <input
                      id="auth-dept"
                      type="text"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Work Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  id="auth-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              <span>{submitting ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Account'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {mode === 'login' && (
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                One-Click Role Preview (Synthetic Demo Workspace)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DEMO_ROLES.map((d) => (
                  <button
                    key={d.email}
                    type="button"
                    disabled={submitting}
                    onClick={() => quickDemoLogin(d.email)}
                    className="text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {d.role}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {d.scope}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
