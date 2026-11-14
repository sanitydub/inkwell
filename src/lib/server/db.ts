import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DATA_DIR } from '$app/env/private';

// Each entry runs once, in order. Never edit a shipped migration; append a new one.
const migrations: string[] = [
	`
	CREATE TABLE users (
		id            TEXT PRIMARY KEY,
		username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
		password_hash TEXT NOT NULL,
		created_at    INTEGER NOT NULL
	);

	-- id is the SHA-256 of the session token; the raw token only lives in the cookie.
	CREATE TABLE sessions (
		id         TEXT PRIMARY KEY,
		user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		created_at INTEGER NOT NULL,
		expires_at INTEGER NOT NULL
	);
	CREATE INDEX sessions_user ON sessions(user_id);

	-- seq is a stable integer key for the full-text index (rowids can change on VACUUM).
	CREATE TABLE notes (
		seq        INTEGER PRIMARY KEY,
		id         TEXT NOT NULL UNIQUE,
		user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		title      TEXT NOT NULL DEFAULT '',
		content    TEXT NOT NULL DEFAULT '',
		pinned     INTEGER NOT NULL DEFAULT 0,
		trashed_at INTEGER,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);
	CREATE INDEX notes_user_updated ON notes(user_id, updated_at DESC);

	CREATE VIRTUAL TABLE notes_fts USING fts5(
		title, content,
		content = 'notes', content_rowid = 'seq',
		tokenize = 'unicode61 remove_diacritics 2'
	);
	CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
		INSERT INTO notes_fts(rowid, title, content) VALUES (new.seq, new.title, new.content);
	END;
	CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
		INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.seq, old.title, old.content);
	END;
	CREATE TRIGGER notes_fts_update AFTER UPDATE OF title, content ON notes BEGIN
		INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.seq, old.title, old.content);
		INSERT INTO notes_fts(rowid, title, content) VALUES (new.seq, new.title, new.content);
	END;
	`
];

let db: DatabaseSync | undefined;

/** Opens the database on first use, so builds never touch the data directory. */
export function getDb(): DatabaseSync {
	if (db) return db;
	const dataDir = resolve(DATA_DIR);
	mkdirSync(dataDir, { recursive: true });
	db = new DatabaseSync(join(dataDir, 'inkwell.db'));
	db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
	migrate(db);
	return db;
}

function migrate(db: DatabaseSync) {
	const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
	for (let v = user_version; v < migrations.length; v++) {
		db.exec('BEGIN');
		try {
			db.exec(migrations[v]);
			db.exec(`PRAGMA user_version = ${v + 1}`);
			db.exec('COMMIT');
		} catch (err) {
			db.exec('ROLLBACK');
			throw err;
		}
	}
}
