import { error } from '@sveltejs/kit';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getDb } from './db';
import type { ApiToken, TokenScope, User } from '#lib/types.ts';

// Personal access tokens for scripts and apps, sent as "Authorization: Bearer ink_…". Only a
// SHA-256 of each token is stored: tokens are 32 random bytes, so unlike passwords they don't need
// a slow hash. The full token is shown once, when it's created.

const PREFIX = 'ink_';
const DAY = 86_400_000;
const MAX_NAME = 60;
const MAX_TOKENS = 50;
/** last_used_at is only written when it's older than this, so busy scripts don't write on every call. */
const TOUCH_EVERY = 60_000;

export const TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;

interface TokenRow {
	id: string;
	user_id: string;
	name: string;
	token_hash: string;
	last_four: string;
	scope: TokenScope;
	created_at: number;
	last_used_at: number | null;
	expires_at: number | null;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

const toToken = (r: TokenRow): ApiToken => ({
	id: r.id,
	name: r.name,
	scope: r.scope,
	lastFour: r.last_four,
	createdAt: r.created_at,
	lastUsedAt: r.last_used_at,
	expiresAt: r.expires_at
});

/** True if a header value looks like one of our tokens (so other Bearer schemes get a clear error). */
export const looksLikeToken = (value: string) => value.startsWith(PREFIX);

export function listTokens(userId: string): ApiToken[] {
	const rows = getDb()
		.prepare('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC')
		.all(userId) as unknown as TokenRow[];
	return rows.map(toToken);
}

/** Creates a token and returns it with its secret, which is never available again. */
export function createToken(userId: string, body: Record<string, unknown>): { token: ApiToken; secret: string } {
	const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : '';
	if (!name) error(400, 'Give the token a name, such as the app or script that will use it.');
	if (name.length > MAX_NAME) error(400, `Token names can be up to ${MAX_NAME} characters.`);
	const scope = body.scope ?? 'write';
	if (scope !== 'read' && scope !== 'write') error(400, 'scope must be "read" or "write".');
	const days = body.expiresInDays ?? null;
	if (days !== null && !TOKEN_EXPIRY_DAYS.includes(days as never)) {
		error(400, `expiresInDays must be one of ${TOKEN_EXPIRY_DAYS.join(', ')}, or null for no expiry.`);
	}

	const db = getDb();
	const { n } = db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?').get(userId) as { n: number };
	if (Number(n) >= MAX_TOKENS) error(400, `You can have up to ${MAX_TOKENS} tokens. Revoke one you no longer use first.`);

	const secret = PREFIX + randomBytes(32).toString('base64url');
	const now = Date.now();
	const row: TokenRow = {
		id: randomUUID(),
		user_id: userId,
		name,
		token_hash: hash(secret),
		last_four: secret.slice(-4),
		scope,
		created_at: now,
		last_used_at: null,
		expires_at: days === null ? null : now + (days as number) * DAY
	};
	db.prepare(
		`INSERT INTO api_tokens (id, user_id, name, token_hash, last_four, scope, created_at, last_used_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(row.id, userId, name, row.token_hash, row.last_four, scope, now, null, row.expires_at);
	return { token: toToken(row), secret };
}

export function revokeToken(userId: string, id: string): boolean {
	return Number(getDb().prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(id, userId).changes) > 0;
}

/** The user and scope a token grants, or null if it's unknown or expired. */
export function validateToken(secret: string): { user: User; scope: TokenScope } | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT t.id AS tid, t.scope, t.last_used_at, t.expires_at, u.id, u.username, u.is_admin, u.created_at
			 FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`
		)
		.get(hash(secret)) as
		| {
				tid: string;
				scope: TokenScope;
				last_used_at: number | null;
				expires_at: number | null;
				id: string;
				username: string;
				is_admin: number;
				created_at: number;
		  }
		| undefined;
	if (!row) return null;
	const now = Date.now();
	if (row.expires_at !== null && row.expires_at <= now) return null;
	if (!row.last_used_at || now - row.last_used_at > TOUCH_EVERY) {
		db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now, row.tid);
	}
	return {
		user: { id: row.id, username: row.username, isAdmin: row.is_admin === 1, createdAt: row.created_at },
		scope: row.scope
	};
}
