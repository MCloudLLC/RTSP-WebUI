import { useEffect, useState, createContext, useContext } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Settings from './pages/Settings.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export default function App() {
  const [status, setStatus] = useState({ loading: true, authRequired: true, authenticated: false });

  const refresh = async () => {
    try {
      const s = await api.authStatus();
      setStatus({ loading: false, ...s });
    } catch {
      setStatus({ loading: false, authRequired: true, authenticated: false });
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  if (status.loading) {
    return <div className="flex h-full items-center justify-center text-slate-400">Loading…</div>;
  }

  const authed = status.authenticated || !status.authRequired;

  return (
    <AuthCtx.Provider value={{ ...status, refresh }}>
      <Routes>
        <Route
          path="/login"
          element={authed ? <Navigate to="/" replace /> : <Login onLogin={refresh} />}
        />
        <Route
          path="/"
          element={authed ? <Shell><Dashboard /></Shell> : <Navigate to="/login" replace />}
        />
        <Route
          path="/settings"
          element={authed ? <Shell><Settings /></Shell> : <Navigate to="/login" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthCtx.Provider>
  );
}

function Shell({ children }) {
  const location = useLocation();
  const { authRequired, refresh } = useAuth();
  const tab = (to, label) => (
    <Link
      to={to}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
        location.pathname === to
          ? 'bg-slate-700 text-white'
          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
      }`}
    >
      {label}
    </Link>
  );

  const logout = async () => {
    await api.logout();
    await refresh();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold tracking-tight text-white">RTSP WebUI</span>
          <nav className="flex gap-1">
            {tab('/', 'Live')}
            {tab('/settings', 'Manage')}
          </nav>
        </div>
        {authRequired && (
          <button
            onClick={logout}
            className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            Sign out
          </button>
        )}
      </header>
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
