"use client";

import { useState } from "react";
import Link from "next/link";
import { apiSend } from "@/lib/client/fetcher";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="animate-fade-in">
      <h1 className="text-xl font-extrabold tracking-tight text-ink">Reset your password</h1>
      <p className="mt-1 mb-5 text-xs text-muted">
        Enter your email or username and a reset token is issued for your administrator to hand over.
      </p>

      {done ? (
        <div className="flex flex-col gap-4 text-center">
          <p className="rounded-xl bg-white/5 px-4 py-3 text-xs text-muted">
            If the account exists, a reset token was issued. Contact your administrator to receive it, then continue below.
          </p>
          <Link href="/reset-password" className="rounded-pill bg-electric py-2.5 text-xs font-bold text-white hover:bg-cyan">
            Enter reset token
          </Link>
          <Link href="/login" className="text-xs text-muted hover:text-cyan">Back to sign in</Link>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await apiSend("/api/auth/password/forgot", "POST", { identifier: identifier.trim() });
              setDone(true);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Something went wrong");
            } finally {
              setBusy(false);
            }
          }}
          className="flex flex-col gap-4"
        >
          <input
            autoFocus
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="Email or username"
            className="w-full rounded-xl border border-hairline bg-bg px-4 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-electric"
          />
          {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-xs font-medium text-danger">{error}</p>}
          <button type="submit" disabled={busy || !identifier} className="rounded-pill bg-electric py-3 text-sm font-bold text-white transition hover:bg-cyan disabled:opacity-40">
            {busy ? "Working…" : "Request reset"}
          </button>
          <Link href="/login" className="text-center text-xs text-muted hover:text-cyan">Back to sign in</Link>
        </form>
      )}
    </div>
  );
}
