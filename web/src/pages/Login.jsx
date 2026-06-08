import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      await onLogin();
    } catch (err) {
      setError(err.status === 401 ? 'Incorrect password' : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl"
      >
        <h1 className="mb-1 text-lg font-semibold text-white">RTSP WebUI</h1>
        <p className="mb-5 text-sm text-slate-400">Enter the access password to continue.</p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="mb-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
        />
        {error && <p className="mb-3 text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
