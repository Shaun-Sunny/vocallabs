'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthenticationStatus, useUserData, useSignInEmailPassword, useSignUpEmailPassword } from '@nhost/nextjs';
import { nhost } from '@/components/NhostProvider';

export default function AuthPage() {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const user = useUserData();
  const router = useRouter();
  const { signInEmailPassword, isLoading: signingIn } = useSignInEmailPassword();
  const { signUpEmailPassword, isLoading: signingUp } = useSignUpEmailPassword();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthenticated && user) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'signin') {
        const { error: err } = await signInEmailPassword(email, password);
        if (err) setError(err.message);
      } else {
        const { error: err } = await signUpEmailPassword(email, password);
        if (err) setError(err.message);
        else setMode('signin');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-brand-100">
      <div className="card w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">AI Workflow Builder</h1>
          <p className="text-sm text-gray-500 mt-1">Chain AI agent steps into powerful workflows</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
          )}

          <button
            type="submit"
            disabled={signingIn || signingUp}
            className="btn-primary w-full"
          >
            {signingIn || signingUp ? 'Loading...' : mode === 'signin' ? 'Sign In' : 'Sign Up'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-500">
          {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
            className="text-brand-600 hover:underline"
          >
            {mode === 'signin' ? 'Sign Up' : 'Sign In'}
          </button>
        </p>

        <div className="mt-6 pt-6 border-t border-gray-100">
          <p className="text-xs text-gray-400 text-center">Demo accounts for Final Task scenario:</p>
          <div className="mt-2 space-y-1 text-xs text-gray-500">
            <p><strong>Org A Owner:</strong> owner-a@demo.com / demo1234</p>
            <p><strong>Org A Editor:</strong> editor-a@demo.com / demo1234</p>
            <p><strong>Org B Editor:</strong> editor-b@demo.com / demo1234</p>
          </div>
        </div>
      </div>
    </div>
  );
}
