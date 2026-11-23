"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiSend } from "@/lib/client/fetcher";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="animate-fade-in">
      <h1 className="text-xl font-extrabold tracking-tight text-ink">Set a new password</h1>
      <p className="mt-1 mb-5 text-xs text-muted">Paste the reset token from your administrator and choose a fresh password.</p>

      {done ? (
        <div className="flex flex-col gap-4 text-center">
          <p className="rounded-xl bg-white/5 px-4 py-3 text-xs text-muted">Password updated. You can sign in with it now.</p>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="rounded-pill bg-electric py-2.5 text-xs font-bold text-white hover:bg-cyan"
          >
            Go to sign in
          </button>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await apiSend("/api/auth/password/reset", "POST", { token: token.trim(), password });
              setDone(true);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Reset failed");
            } finally {
              setBusy(false);
            }
          }}
          className="flex flex-col gap-4"
        >
          <input
            autoFocus
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Reset token"
            className="w-full rounded-xl border border-hairline bg-bg px-4 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-electric"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password (8+ characters)"
            className="w-full rounded-xl border border-hairline bg-bg px-4 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-electric"
          />
          {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-xs font-medium text-danger">{error}</p>}
          <button
            type="submit"
            disabled={busy || !token || password.length < 8}
            className="rounded-pill bg-electric py-3 text-sm font-bold text-white transition hover:bg-cyan disabled:opacity-40"
          >
            {busy ? "Saving…" : "Update password"}
          </button>
          <Link href="/login" className="text-center text-xs text-muted hover:text-cyan">Back to sign in</Link>
        </form>
      )}
    </div>
  );
}
