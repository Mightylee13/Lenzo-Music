"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/store/session";

function LoginForm() {
  const session = useSession();
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await session.login(identifier.trim(), password);
          router.push(next);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Sign in failed");
        } finally {
          setBusy(false);
        }
      }}
      className="flex flex-col gap-4"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-muted">Email or username</span>
        <input
          autoFocus
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className="w-full rounded-xl border border-hairline bg-bg px-4 py-2.5 text-sm text-ink outline-none focus:border-electric"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-muted">Password</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-hairline bg-bg px-4 py-2.5 text-sm text-ink outline-none focus:border-electric"
        />
      </label>

      {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-xs font-medium text-danger">{error}</p>}

      <button
        type="submit"
        disabled={busy || !identifier || !password}
        className="mt-1 rounded-pill bg-electric py-3 text-sm font-bold text-white transition hover:bg-cyan disabled:opacity-40"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>

      <div className="flex items-center justify-between text-xs">
        <Link href="/forgot-password" className="text-muted hover:text-cyan">Forgot password?</Link>
        <Link href={
          (() => {
            const sp = new URLSearchParams(search.toString());
            if (next) sp.set("next", next);
            return `/signup?${sp.toString()}`;
          })()
        } className="font-bold text-cyan hover:underline">
          Create an account
        </Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="animate-fade-in">
      <h1 className="text-xl font-extrabold tracking-tight text-ink">Welcome back</h1>
      <p className="mt-1 mb-5 text-xs text-muted">Sign in to sync playlists, likes and downloads.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
