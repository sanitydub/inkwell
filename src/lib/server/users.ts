import { error } from '@sveltejs/kit';
import { getDb } from './db';
import { createUser, parseNewCredentials, parsePassword, setPassword } from './auth';
import { removeUserAttachments } from './attachments';
import type { ManagedUser } from '#lib/types.ts';

// Account management for admins.

interface UserRow {
	id: string;
	username: string;
	is_admin: number;
	created_at: number;
	note_count: number;
}

const toManaged = (r: UserRow): ManagedUser => ({
	id: r.id,
	username: r.username,
	isAdmin: r.is_admin === 1,
	createdAt: r.created_at,
	noteCount: Number(r.note_count)
});

const SELECT = `SELECT u.id, u.username, u.is_admin, u.created_at,
	(SELECT COUNT(*) FROM notes n WHERE n.user_id = u.id AND n.trashed_at IS NULL) AS note_count
	FROM users u`;

export function listUsers(): ManagedUser[] {
	return (getDb().prepare(`${SELECT} ORDER BY u.created_at`).all() as unknown as UserRow[]).map(toManaged);
}

function getUser(id: string): ManagedUser | null {
	const row = getDb().prepare(`${SELECT} WHERE u.id = ?`).get(id);
	return row ? toManaged(row as unknown as UserRow) : null;
}

function adminCount(): number {
	return Number((getDb().prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get() as { n: number }).n);
}

const NOT_FOUND = 'This account doesn’t exist, or it was deleted.';

/** Admins can create accounts whether or not sign-ups are open. */
export async function adminCreateUser(body: Record<string, unknown>): Promise<ManagedUser> {
	const { username, password } = parseNewCredentials(body);
	if (body.isAdmin !== undefined && typeof body.isAdmin !== 'boolean') error(400, '"isAdmin" must be true or false.');
	const user = await createUser(username, password, body.isAdmin === true);
	return { ...user, noteCount: 0 };
}

/** Resets a password (signing that person out everywhere) and/or changes admin status. */
export async function adminUpdateUser(actorId: string, id: string, body: Record<string, unknown>): Promise<ManagedUser> {
	const target = getUser(id);
	if (!target) error(404, NOT_FOUND);
	if ('isAdmin' in body) {
		if (typeof body.isAdmin !== 'boolean') error(400, '"isAdmin" must be true or false.');
		if (!body.isAdmin && target.isAdmin && adminCount() === 1) {
			error(409, 'There has to be at least one admin. Make someone else an admin first.');
		}
		getDb().prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(body.isAdmin ? 1 : 0, id);
	}
	if ('password' in body) {
		if (id === actorId) error(400, 'Change your own password in the Password section instead.');
		await setPassword(id, parsePassword(body.password));
	}
	if (!('isAdmin' in body) && !('password' in body)) error(400, 'Send "password", "isAdmin" or both.');
	return getUser(id)!;
}

/** Deletes an account and all its notes and notebooks. */
export function adminDeleteUser(actorId: string, id: string) {
	if (id === actorId) error(400, 'You can’t delete your own account here.');
	const target = getUser(id);
	if (!target) error(404, NOT_FOUND);
	if (target.isAdmin && adminCount() === 1) error(409, 'There has to be at least one admin.');
	getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
	removeUserAttachments(id);
}
