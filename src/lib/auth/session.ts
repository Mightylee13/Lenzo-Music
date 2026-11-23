import "server-only";
import { cookies } from "next/headers";
import { collection, updateDb, ensureDbLoaded } from "@/lib/db/json-store";
import { generateToken } from "@/lib/auth/password";
import type { PublicUser, User } from "@/types";

const COOKIE = "bw_session";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

interface SessionRecord {
  token: string;
  userId: string;
  expiresAt: number;
}

interface ResetRecord {
  token: string;
  userId: string;
  expiresAt: number;
}

export function publicUser(u: User): PublicUser {
  const { id, username, email, avatar, bio, role, createdAt } = u;
  return { id, username, email, avatar, bio, role, createdAt };
}

export function findUserByToken(token: string): User | null {
  const sessions = collection<SessionRecord>("sessions");
  const record = sessions.find((s) => s.token === token);
  if (!record) return null;
  if (record.expiresAt < Date.now()) return null;
  return collection<User>("users").find((u) => u.id === record.userId) ?? null;
}

export async function getSessionUser(): Promise<User | null> {
  await ensureDbLoaded();
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  return findUserByToken(token);
}

export async function createSession(userId: string): Promise<void> {
  const token = generateToken();
  const expiresAt = Date.now() + THIRTY_DAYS * 1000;
  updateDb((db) => {
    const sessions = (db.sessions as SessionRecord[]) ?? [];
    // Prune expired sessions opportunistically.
    const alive = sessions.filter((s) => s.expiresAt > Date.now());
    alive.push({ token, userId, expiresAt });
    db.sessions = alive;
  });
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    updateDb((db) => {
      db.sessions = ((db.sessions as SessionRecord[]) ?? []).filter((s) => s.token !== token);
    });
  }
  store.delete(COOKIE);
}

/* ---------- Password reset (token-based, single use) ---------- */

export function createPasswordReset(userId: string): string {
  const token = generateToken(24);
  updateDb((db) => {
    db.passwordResets = [
      ...(((db.passwordResets as ResetRecord[]) ?? []).filter((r) => r.expiresAt > Date.now())),
      { token, userId, expiresAt: Date.now() + 1000 * 60 * 60 },
    ];
  });
  return token;
}

export function consumePasswordReset(token: string): string | null {
  const resets = collection<ResetRecord>("passwordResets");
  const record = resets.find((r) => r.token === token && r.expiresAt > Date.now());
  if (!record) return null;
  updateDb((db) => {
    db.passwordResets = ((db.passwordResets as ResetRecord[]) ?? []).filter((r) => r.token !== token);
  });
  return record.userId;
}
