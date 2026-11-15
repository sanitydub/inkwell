import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DATA_DIR } from '$app/env/private';
import { extractTags } from '#lib/tags.ts';
import { extractLinks } from '#lib/links.ts';

// Each entry runs once, in order. Never edit a shipped migration; append a new one.
// An entry is SQL, or a function for changes that need code (like backfilling data).
const migrations: (string | ((db: DatabaseSync) => void))[] = [
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
	`,

	// 2: flat notebooks and inline #tags.
	(db) => {
		db.exec(`
			CREATE TABLE notebooks (
				id         TEXT PRIMARY KEY,
				user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				name       TEXT NOT NULL COLLATE NOCASE,
				created_at INTEGER NOT NULL,
				UNIQUE (user_id, name)
			);

			-- Deleting a notebook keeps its notes; they just lose the notebook.
			ALTER TABLE notes ADD COLUMN notebook_id TEXT REFERENCES notebooks(id) ON DELETE SET NULL;
			CREATE INDEX notes_notebook ON notes(notebook_id);

			-- Tags are parsed from note content on save; this is just an index of them.
			CREATE TABLE note_tags (
				note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
				tag     TEXT NOT NULL,
				PRIMARY KEY (note_id, tag)
			) WITHOUT ROWID;
			CREATE INDEX note_tags_tag ON note_tags(tag);
		`);
		const insert = db.prepare('INSERT INTO note_tags (note_id, tag) VALUES (?, ?)');
		for (const row of db.prepare('SELECT id, content FROM notes').all() as { id: string; content: string }[]) {
			for (const tag of extractTags(row.content)) insert.run(row.id, tag);
		}
	},

	// 3: [[wiki-links]], indexed by normalized target title for backlinks.
	(db) => {
		db.exec(`
			CREATE TABLE note_links (
				note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
				target  TEXT NOT NULL,
				PRIMARY KEY (note_id, target)
			) WITHOUT ROWID;
			CREATE INDEX note_links_target ON note_links(target);
		`);
		const insert = db.prepare('INSERT INTO note_links (note_id, target) VALUES (?, ?)');
		for (const row of db.prepare('SELECT id, content FROM notes').all() as { id: string; content: string }[]) {
			for (const target of extractLinks(row.content)) insert.run(row.id, target);
		}
	},

	// 4: admins. The oldest existing account becomes the admin.
	`
	ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
	UPDATE users SET is_admin = 1 WHERE id = (SELECT id FROM users ORDER BY created_at LIMIT 1);
	`,

	// 5: attachments. Files live in DATA_DIR/attachments/<user id>/<id>; this is their index.
	`
	CREATE TABLE attachments (
		id         TEXT PRIMARY KEY,
		user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		name       TEXT NOT NULL,
		type       TEXT NOT NULL,
		size       INTEGER NOT NULL,
		sha256     TEXT NOT NULL,
		created_at INTEGER NOT NULL
	);
	CREATE INDEX attachments_user_hash ON attachments(user_id, sha256);
	`,
	// 6: version history. Earlier copies of a note's title and text, thinned out as they age.
	`
	CREATE TABLE note_versions (
		id         TEXT PRIMARY KEY,
		note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
		title      TEXT NOT NULL,
		content    TEXT NOT NULL,
		reason     TEXT NOT NULL,
		created_at INTEGER NOT NULL
	);
	CREATE INDEX note_versions_note ON note_versions(note_id, created_at DESC);
	`
];

let db: DatabaseSync | undefined;

/** The data directory (database and attachments), as an absolute path. */
export const dataDirectory = () => resolve(DATA_DIR);

/** Opens the database on first use, so builds never touch the data directory. */
export function getDb(): DatabaseSync {
	if (db) return db;
	const dataDir = dataDirectory();
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
			const step = migrations[v];
			if (typeof step === 'string') db.exec(step);
			else step(db);
			db.exec(`PRAGMA user_version = ${v + 1}`);
			db.exec('COMMIT');
		} catch (err) {
			db.exec('ROLLBACK');
			throw err;
		}
	}
}

/** Runs fn inside a transaction, rolling back if it throws. Not re-entrant. */
export function transaction<T>(fn: () => T): T {
	const db = getDb();
	db.exec('BEGIN');
	try {
		const result = fn();
		db.exec('COMMIT');
		return result;
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
}
