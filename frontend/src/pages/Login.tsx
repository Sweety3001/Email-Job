import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/Button";

export default function Login() {
  const { user, loading } = useAuth();
  const googleError = new URLSearchParams(window.location.search).get("error");

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </div>
    );
  }
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-lg">
        <div className="flex flex-col items-center">
          <span className="text-3xl">📬</span>
          <h1 className="mt-3 text-xl font-bold text-gray-900">Welcome to ReachInbox</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to schedule your email campaigns</p>
        </div>

        {googleError && (
          <div className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            Google sign-in failed ({googleError}). Make sure GOOGLE_CLIENT_ID/SECRET are set in the backend .env.
          </div>
        )}

        <a href={api.auth.googleUrl} className="mt-6 block">
          <Button variant="google" size="lg" className="w-full">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3.02h3.86c2.26-2.09 3.56-5.17 3.56-8.9z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3.02c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.13A11.99 11.99 0 0 0 12 24z"
              />
              <path fill="#FBBC05" d="M5.27 14.27A7.19 7.19 0 0 1 4.89 12c0-.78.14-1.54.38-2.27V6.6H1.29A11.99 11.99 0 0 0 0 12c0 1.94.46 3.77 1.29 5.4l3.98-3.13z" />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.6l3.98 3.13C6.22 6.86 8.87 4.75 12 4.75z"
              />
            </svg>
            Sign in with Google
          </Button>
        </a>

        <p className="mt-4 text-center text-xs text-gray-400">
          Uses real Google OAuth 2.0 — configure GOOGLE_CLIENT_ID/SECRET in backend/.env.
        </p>
      </div>
    </div>
  );
}
