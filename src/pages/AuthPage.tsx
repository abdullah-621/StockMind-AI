import React, { useState } from 'react';
import { Activity, Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function AuthPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed. Please check your credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b1120] flex items-center justify-center p-4">
      {/* Subtle radial glow behind the card */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(37,99,235,0.08) 0%, transparent 70%)',
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Login Card */}
        <div
          className="rounded-2xl border border-slate-800 p-8 sm:p-10 shadow-2xl"
          style={{ background: '#0f1a2e' }}
        >
          {/* ── Branding ── */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center shadow-lg"
              style={{
                background: 'linear-gradient(135deg, #1d4ed8 0%, #0ea5e9 100%)',
                boxShadow: '0 0 24px rgba(14,165,233,0.25)',
              }}
            >
              <Activity className="w-6 h-6 text-white" strokeWidth={2.2} />
            </div>
            <div className="text-center">
              <h1 className="font-display font-bold text-white text-xl tracking-tight">
                StockMind AI
              </h1>
              <p className="text-slate-400 text-xs mt-0.5 tracking-wide uppercase font-medium">
                Admin Workspace
              </p>
            </div>
          </div>

          {/* ── Error Banner ── */}
          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2.5 p-3 rounded-lg border text-xs leading-relaxed"
              style={{
                background: 'rgba(220,38,38,0.08)',
                borderColor: 'rgba(220,38,38,0.3)',
                color: '#fca5a5',
              }}
            >
              <span className="mt-px shrink-0">⚠</span>
              <span>{error}</span>
            </div>
          )}

          {/* ── Form ── */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email */}
            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium text-slate-400 mb-1.5"
              >
                Email Address
              </label>
              <div className="relative">
                <Mail
                  className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: '#475569' }}
                />
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@stockmind.ai"
                  className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border text-slate-100 placeholder-slate-600 focus:outline-none transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    borderColor: '#1e3a5f',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#2563eb')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#1e3a5f')}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="auth-password"
                className="block text-xs font-medium text-slate-400 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock
                  className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: '#475569' }}
                />
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-11 py-2.5 text-sm rounded-lg border text-slate-100 placeholder-slate-600 focus:outline-none transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    borderColor: '#1e3a5f',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#2563eb')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#1e3a5f')}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors focus:outline-none"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Sign In Button */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-white text-sm font-semibold transition-all duration-150 mt-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#0f1a2e] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: submitting
                  ? 'rgba(37,99,235,0.6)'
                  : 'linear-gradient(135deg, #1d4ed8 0%, #0ea5e9 100%)',
                boxShadow: submitting ? 'none' : '0 4px 20px rgba(14,165,233,0.2)',
              }}
              onMouseEnter={(e) => {
                if (!submitting)
                  e.currentTarget.style.boxShadow = '0 4px 28px rgba(14,165,233,0.35)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = submitting
                  ? 'none'
                  : '0 4px 20px rgba(14,165,233,0.2)';
              }}
            >
              {submitting ? (
                <>
                  <svg
                    className="animate-spin w-4 h-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                  <span>Signing In…</span>
                </>
              ) : (
                <span>Sign In</span>
              )}
            </button>
          </form>

          {/* ── Footer ── */}
          <div className="mt-8 flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" style={{ color: '#334155' }} />
            <span className="text-[11px] text-slate-600 tracking-wide">Secure Admin Access</span>
          </div>
        </div>
      </div>
    </div>
  );
}
