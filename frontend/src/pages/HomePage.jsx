import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';

export default function HomePage() {
  const navigate = useNavigate();
  const { login, loading, error } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [secErr, setSecErr] = useState('');
  const [showPass, setShowPass] = useState(false);

  const handleSecLogin = async (e) => {
    e.preventDefault();
    setSecErr('');
    const ok = await login(form.username.trim(), form.password);
    if (ok) navigate('/admin');
    else setSecErr('Invalid credentials. Check username and password.');
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-4 py-14 overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">

      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-blue-600/10 blur-3xl" />
        <div className="absolute top-1/2 -right-32 h-80 w-80 rounded-full bg-indigo-600/10 blur-3xl" />
        <div className="absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-blue-500/8 blur-3xl" />
        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '48px 48px' }} />
      </div>

      {/* Hero */}
      <div className="relative mb-12 text-center">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-2xl shadow-blue-900/50 text-4xl ring-1 ring-white/10">
          🧭
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          AI Campus{' '}
          <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            Navigator
          </span>
        </h1>
        <p className="mt-3 text-slate-400 text-base max-w-sm mx-auto leading-relaxed">
          Smart, real-time campus navigation powered by AI
        </p>

        {/* Feature pills */}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {['🗺️ Live Map', '💬 AI Chatbot', '🛡️ Road Status'].map((f) => (
            <span key={f} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-400 backdrop-blur">
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Cards */}
      <div className="relative w-full max-w-4xl grid grid-cols-1 gap-5 md:grid-cols-2">

        {/* ── Visitor Card ── */}
        <div className="group flex flex-col rounded-3xl border border-white/10 bg-white/5 p-7 backdrop-blur-sm shadow-xl shadow-black/30 ring-1 ring-white/5 transition-all hover:bg-white/8 hover:border-white/15">
          
          {/* Card header */}
          <div className="mb-7">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg shadow-blue-900/40 text-2xl">
              🗺️
            </div>
            <h2 className="text-xl font-bold text-white">Explore Campus</h2>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              No sign-in needed — jump right in. Browse the interactive map, find buildings, and get AI-powered directions.
            </p>
          </div>

          {/* Feature list */}
          <ul className="mb-7 space-y-2.5">
            {[
              'Interactive campus map with routing',
              'AI chatbot for directions & info',
              'Real-time road status updates',
            ].map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-sm text-slate-300">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400">
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </span>
                {f}
              </li>
            ))}
          </ul>

          {/* Actions */}
          <div className="mt-auto space-y-2.5">
            <button
              onClick={() => navigate('/map')}
              className="w-full rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-900/40 transition-all hover:from-blue-400 hover:to-indigo-500 hover:shadow-blue-900/60 active:scale-[.98]"
            >
              🗺️ &nbsp;Open Map
            </button>
            <button
              onClick={() => navigate('/chatbot')}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-sm font-semibold text-slate-300 transition-all hover:bg-white/10 hover:text-white active:scale-[.98]"
            >
              💬 &nbsp;Ask the Campus Chatbot
            </button>
          </div>
        </div>

        {/* ── Security Card ── */}
        <div className="flex flex-col rounded-3xl border border-white/10 bg-white/5 p-7 backdrop-blur-sm shadow-xl shadow-black/30 ring-1 ring-white/5 transition-all hover:bg-white/8 hover:border-white/15">

          {/* Card header */}
          <div className="mb-6">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-600 to-slate-800 shadow-lg border border-white/10 text-2xl">
              🛡️
            </div>
            <h2 className="text-xl font-bold text-white">Security Officer</h2>
            <p className="mt-1.5 text-sm text-slate-400">
              Restricted access — credentials required
            </p>
          </div>

          <form onSubmit={handleSecLogin} className="flex flex-col flex-1 space-y-4">
            {(secErr || error) && (
              <div className="flex items-center gap-2.5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {secErr || error}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-slate-500">
                Username
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </span>
                <input
                  type="text"
                  placeholder="e.g. admin"
                  value={form.username}
                  onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                  required
                  className="w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-slate-500">
                Password
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </span>
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  required
                  className="w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-11 py-3 text-sm text-white placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                  tabIndex={-1}
                >
                  {showPass ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="pt-1">
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl border border-white/10 bg-gradient-to-br from-slate-700 to-slate-800 px-4 py-3.5 text-sm font-bold text-white shadow-lg transition-all hover:from-slate-600 hover:to-slate-700 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Signing in…
                  </span>
                ) : (
                  '🛡️  Login as Security Officer'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      <p className="relative mt-10 text-xs text-slate-600">AI Campus Intelligence System · v2.0</p>
    </div>
  );
}