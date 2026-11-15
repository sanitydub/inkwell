import { error, type RequestEvent } from '@sveltejs/kit';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { ALLOW_REGISTRATION } from '$app/env/private';
import { getDb } from './db';
import type { User } from '#lib/types.ts';

export const SESSION_COOKIE = 'inkwell_session';

const DAY = 86_400_000;
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

interface UserRow {
	id: string;
	username: string;
	password_hash: string;
	is_admin: number;
	created_at: number;
}

const toUser = (r: { id: string; username: string; is_admin: number; created_at: number }): User => ({
	id: r.id,
	username: r.username,
	isAdmin: r.is_admin === 1,
	createdAt: r.created_at
});

// ---- Passwords --------------------------------------------------------------

function deriveKey(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
	return new Promise((ok, fail) =>
		scrypt(password, salt, SCRYPT.keylen, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) =>
			err ? fail(err) : ok(key)
		)
	);
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const key = await deriveKey(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p);
	return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [alg, n, r, p, salt, hash] = stored.split('$');
	if (alg !== 'scrypt' || !salt || !hash) return false;
	const expected = Buffer.from(hash, 'base64');
	const key = await deriveKey(password, Buffer.from(salt, 'base64'), +n, +r, +p);
	return key.length === expected.length && timingSafeEqual(key, expected);
}

// Hashed once, used to make failed logins for unknown users take as long as real ones.
let dummyHash: Promise<string> | undefined;

// ---- Users ------------------------------------------------------------------

export function userCount(): number {
	const row = getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
	return Number(row.n);
}

/** Sign-ups are open unless ALLOW_REGISTRATION=false, but the first account is always allowed. */
export function registrationOpen(): boolean {
	return ALLOW_REGISTRATION || userCount() === 0;
}

/** Validates a new password, with the field name used in error messages. */
export function parsePassword(value: unknown, what = 'Passwords'): string {
	if (typeof value !== 'string' || value.length < 8) error(400, `${what} need at least 8 characters.`);
	if (value.length > 1024) error(400, `${what} can be at most 1024 characters.`);
	return value;
}

export function parseNewCredentials(body: Record<string, unknown>) {
	const { username } = body;
	if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
		error(400, 'Usernames are 3–32 characters: letters, numbers, dots, dashes and underscores.');
	}
	return { username: username.trim(), password: parsePassword(body.password) };
}

/** Creates an account. The first account on the server is always an admin. */
export async function createUser(username: string, password: string, isAdmin = false): Promise<User> {
	const db = getDb();
	if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
		error(409, 'That username is taken. Try another one.');
	}
	const hash = await hashPassword(password);
	const user: User = { id: randomUUID(), username, isAdmin: isAdmin || userCount() === 0, createdAt: Date.now() };
	db.prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)').run(
		user.id,
		user.username,
		hash,
		user.isAdmin ? 1 : 0,
		user.createdAt
	);
	return user;
}

/** Replaces a user's password and signs out all their sessions except `keepToken`, if given. */
export async function setPassword(userId: string, password: string, keepToken?: string) {
	const hash = await hashPassword(password);
	const db = getDb();
	db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
	db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, keepToken ? hashToken(keepToken) : '');
}

/** Checks a signed-in user's current password (for changing it). */
export async function checkPassword(userId: string, password: unknown): Promise<boolean> {
	if (typeof password !== 'string' || password.length > 1024) return false;
	const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
		| { password_hash: string }
		| undefined;
	return !!row && (await verifyPassword(password, row.password_hash));
}

export async function authenticate(username: unknown, password: unknown): Promise<User | null> {
	if (typeof username !== 'string' || typeof password !== 'string' || password.length > 1024) return null;
	const row = getDb()
		.prepare('SELECT id, username, password_hash, created_at FROM users WHERE username = ?')
		.get(username.trim()) as UserRow | undefined;
	if (!row) {
		dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
		await verifyPassword(password, await dummyHash);
		return null;
	}
	return (await verifyPassword(password, row.password_hash)) ? toUser(row) : null;
}

// ---- Sessions ---------------------------------------------------------------

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function createSession(userId: string) {
	const db = getDb();
	const token = randomBytes(32).toString('base64url');
	const now = Date.now();
	const expiresAt = now + SESSION_DAYS * DAY;
	db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
	db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
		hashToken(token),
		userId,
		now,
		expiresAt
	);
	return { token, expiresAt };
}

/** Looks up a session token. Sessions in their second half of life are extended. */
export function validateSession(token: string) {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT s.id AS sid, s.expires_at, u.id, u.username, u.is_admin, u.created_at
			 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
		)
		.get(hashToken(token)) as
		| { sid: string; expires_at: number; id: string; username: string; is_admin: number; created_at: number }
		| undefined;
	if (!row) return null;

	const now = Date.now();
	if (row.expires_at <= now) {
		db.prepare('DELETE FROM sessions WHERE id = ?').run(row.sid);
		return null;
	}
	let expiresAt = row.expires_at;
	let renewed = false;
	if (expiresAt - now < (SESSION_DAYS / 2) * DAY) {
		expiresAt = now + SESSION_DAYS * DAY;
		db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(expiresAt, row.sid);
		renewed = true;
	}
	return { user: toUser(row), expiresAt, renewed };
}

export function deleteSession(token: string) {
	getDb().prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
}

/** How many signed-in sessions a user has besides the current one. */
export function countOtherSessions(userId: string, currentToken: string): number {
	const row = getDb()
		.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND id != ? AND expires_at > ?')
		.get(userId, hashToken(currentToken), Date.now()) as { n: number };
	return Number(row.n);
}

/** Signs a user out everywhere except the current session. Returns how many were signed out. */
export function deleteOtherSessions(userId: string, currentToken: string): number {
	const res = getDb()
		.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
		.run(userId, hashToken(currentToken));
	return Number(res.changes);
}

// Secure cookies only over HTTPS, so plain-HTTP LAN installs can still sign in.
export function setSessionCookie(event: RequestEvent, token: string, expiresAt: number) {
	event.cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: event.url.protocol === 'https:',
		expires: new Date(expiresAt)
	});
}

export function clearSessionCookie(event: RequestEvent) {
	event.cookies.delete(SESSION_COOKIE, { path: '/', secure: event.url.protocol === 'https:' });
}
