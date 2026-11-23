"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/store/session";

function SignupForm() {
  const session = useSession();
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await session.register(form.username.trim(), form.email.trim(), form.password);
          router.push(next);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Sign up failed");
        } finally {
          setBusy(false);
        }
      }}
      className="flex flex-col gap-4"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-muted">Username</span>
        <input
          autoFocus
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          placeholder="3–32 characters"
          className="w-full rounded-xl border border-hairline bg-bg px-4 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-electric"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-muted">Email</span>
        <input
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="w-full rounded-xl border border-hairline bg-bg px-4 py-2.5 text-sm text-ink outline-none focus:border-electric"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-muted">Password</span>
        <input
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder="At least 8 characters"
          className="w-full rounded-xl border border-hairline bg-bg px-4 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-electric"
        />
      </label>

      {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-xs font-medium text-danger">{error}</p>}

      <button
        type="submit"
        disabled={busy || !form.username || !form.email || form.password.length < 8}
        className="mt-1 rounded-pill bg-electric py-3 text-sm font-bold text-white transition hover:bg-cyan disabled:opacity-40"
      >
        {busy ? "Creating account…" : "Create account"}
      </button>

      <p className="text-center text-xs text-muted">
        Already on Lenzo Music?{" "}
        <Link href={next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`} className="font-bold text-cyan hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export default function SignupPage() {
  return (
    <div className="animate-fade-in">
      <h1 className="text-xl font-extrabold tracking-tight text-ink">Join Lenzo Music</h1>
      <p className="mt-1 mb-5 text-xs text-muted">Playlists, likes and history — all in one wave.</p>
      <Suspense>
        <SignupForm />
      </Suspense>
    </div>
  );
}
