import "server-only";
import { collection, updateDb } from "@/lib/db/json-store";
import type { User, UserSettings } from "@/types";

export const DEFAULT_SETTINGS: UserSettings = {
  audioQuality: "high",
  crossfade: 0,
  normalizeVolume: true,
  explicitContent: true,
  autoplay: true,
  theme: "midnight",
  language: "en",
  notifications: true,
  downloadWifiOnly: true,
  privateSession: false,
  dataSaver: false,
};

export function users(): User[] {
  return collection<User>("users");
}

export function findUserById(id: string): User | null {
  return users().find((u) => u.id === id) ?? null;
}

export function findUserByEmail(email: string): User | null {
  const needle = email.trim().toLowerCase();
  return users().find((u) => u.email.toLowerCase() === needle) ?? null;
}

export function findUserByUsername(username: string): User | null {
  const needle = username.trim().toLowerCase();
  return users().find((u) => u.username.toLowerCase() === needle) ?? null;
}

export interface NewUserInput {
  username: string;
  email: string;
  passwordHash: string;
}

export function createUser(input: NewUserInput): User {
  const now = Date.now();
  const isFirstUser = users().length === 0;

  const user: User = {
    id: `u_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    username: input.username.trim(),
    email: input.email.trim().toLowerCase(),
    avatar: "",
    bio: "",
    role: isFirstUser ? "admin" : "user",
    createdAt: now,
    followers: [],
    following: [],
    recentlyPlayed: [],
    likedTracks: [],
    savedAlbums: [],
    followedArtists: [],
    followedPodcasts: [],
    downloads: [],
    settings: { ...DEFAULT_SETTINGS },
    // Stored alongside the user but never serialised to the client.
    ...({ passwordHash: input.passwordHash } as object),
  } as User;

  updateDb((db) => {
    const list = (db.users as User[]) ?? [];
    list.push(user);
    db.users = list;
  });

  return user;
}

export function patchUser(id: string, patch: Partial<User>): User | null {
  let updated: User | null = null;
  updateDb((db) => {
    const list = (db.users as User[]) ?? [];
    const idx = list.findIndex((u) => u.id === id);
    if (idx === -1) return;
    list[idx] = { ...list[idx], ...patch, id: list[idx].id, role: list[idx].role };
    updated = list[idx];
    db.users = list;
  });
  return updated;
}

export function patchUserSettings(id: string, patch: Partial<UserSettings>): User | null {
  const user = findUserById(id);
  if (!user) return null;
  return patchUser(id, { settings: { ...user.settings, ...patch } });
}

/** Password hash lives in the store but must never cross the wire. */
export function getPasswordHash(user: User): string | undefined {
  return (user as unknown as { passwordHash?: string }).passwordHash;
}

export function setPasswordHash(id: string, hash: string): void {
  updateDb((db) => {
    const list = (db.users as User[]) ?? [];
    const idx = list.findIndex((u) => u.id === id);
    if (idx === -1) return;
    (list[idx] as unknown as { passwordHash?: string }).passwordHash = hash;
    db.users = list;
  });
}
