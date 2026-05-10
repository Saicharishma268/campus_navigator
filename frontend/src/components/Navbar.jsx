import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';

const visitorNav = [
  { name: 'Home',    path: '/' },
  { name: 'Map',     path: '/map' },
  { name: 'Chatbot', path: '/chatbot' },
];

const securityNav = [
  { name: 'Map',                path: '/map' },
  { name: 'Security Dashboard', path: '/admin' },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const { isAuthenticated, admin, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/'); };
  const navItems = isAuthenticated ? securityNav : visitorNav;

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-900/80 backdrop-blur-md">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">

        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md shadow-blue-900/40 text-base">
            🧭
          </div>
          <span className="text-base font-bold text-white">AI Campus Navigator</span>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          className="rounded-xl border border-white/10 p-2 text-slate-400 hover:bg-white/10 hover:text-white transition-colors md:hidden"
          onClick={() => setOpen(p => !p)}
          aria-label="Toggle menu"
        >
          {open ? (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>

        {/* Desktop nav */}
        <div className="hidden items-center gap-1 md:flex">
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                isActive
                  ? 'rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-blue-900/30'
                  : 'rounded-xl px-4 py-2 text-sm font-medium text-slate-400 hover:bg-white/8 hover:text-white transition-colors'
              }
            >
              {item.name}
            </NavLink>
          ))}

          {isAuthenticated && (
            <button
              onClick={handleLogout}
              className="ml-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {admin?.username}
            </button>
          )}
        </div>
      </nav>

      {/* Mobile menu */}
      {open && (
        <div className="border-t border-white/10 bg-slate-900/95 px-4 py-3 md:hidden backdrop-blur-md">
          <div className="flex flex-col gap-1">
            {navItems.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  isActive
                    ? 'rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white'
                    : 'rounded-xl px-4 py-2.5 text-sm font-medium text-slate-400 hover:bg-white/8 hover:text-white transition-colors'
                }
                onClick={() => setOpen(false)}
              >
                {item.name}
              </NavLink>
            ))}
            {isAuthenticated && (
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-left text-sm font-medium text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign Out ({admin?.username})
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}