# Inkwell

A simple note-taking app you host yourself. Write in Markdown with a live preview, find anything with full-text search, and keep everything in a single SQLite file on your own server.

- Markdown editor (CodeMirror) with Write, Split and Read layouts
- Full-text search with prefix matching
- Pin notes, move them to the trash, restore them, or delete them for good
- Download any note as a `.md` file
- Multiple accounts per server, each with private notes
- Light and dark themes, phone and desktop layouts
- No external requests: fonts and scripts are served by the app itself

## Run it with Docker

```bash
docker compose up -d
```

Open http://localhost:3000 and create the first account. Notes are stored in the `inkwell-data` volume.

Before exposing it to a network, edit `docker-compose.yml`:

- `ORIGIN`: the exact address people use, e.g. `https://notes.example.com`
- `ALLOW_REGISTRATION`: set to `"false"` once everyone has an account (the first account can always be created)

Put it behind a reverse proxy with HTTPS (Caddy, Traefik, nginx) for anything beyond your LAN. Session cookies are marked `Secure` automatically when the app is served over HTTPS.

## Run it without Docker

Requires Node.js 22.13 or newer (it uses Node's built-in SQLite).

```bash
npm ci
npm run build
DATA_DIR=./data ORIGIN=http://localhost:3000 node build
```

## Configuration

| Variable             | Default | Purpose                                                        |
| -------------------- | ------- | -------------------------------------------------------------- |
| `DATA_DIR`           | `data`  | Folder for `inkwell.db`. Created if missing.                   |
| `ALLOW_REGISTRATION` | `true`  | Whether new people can sign up. The first account always can.  |
| `ORIGIN`             | —       | Public URL of the app. Needed in production.                   |
| `PORT`               | `3000`  | Port to listen on.                                             |
| `BODY_SIZE_LIMIT`    | `512K`  | Largest request accepted (Docker image sets `10M` for big notes). |

Behind a proxy that terminates TLS, you can use `PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host` instead of `ORIGIN`. See the [adapter-node docs](https://svelte.dev/docs/kit/adapter-node) for all server options.

## Backups

Everything lives in `DATA_DIR/inkwell.db`. To back it up while the app is running, use SQLite's online backup:

```bash
sqlite3 data/inkwell.db ".backup 'inkwell-backup.db'"
```

## Development

```bash
npm install
npm run dev     # http://localhost:5173
npm run check   # type-check
```

Stack: [SvelteKit](https://svelte.dev/docs/kit) 3 (Svelte 5), Node's built-in `node:sqlite` with FTS5, CodeMirror 6, marked + DOMPurify.

```
src/
  env.ts                  environment variables (validated at startup)
  hooks.server.ts         resolves the signed-in user from the session cookie
  lib/server/             database, migrations, auth, notes queries (server only)
  lib/workspace.svelte.ts client state: note list, open note, autosave
  lib/components/         Sidebar, NoteList, NotePane, Editor, Preview
  routes/api/             JSON API (also the API for future native clients)
```

### API

All endpoints take and return JSON. Authentication is a session cookie set by register or login.

| Method   | Path                  | Body / query                                  |
| -------- | --------------------- | --------------------------------------------- |
| `POST`   | `/api/auth/register`  | `{ username, password }`                      |
| `POST`   | `/api/auth/login`     | `{ username, password }`                      |
| `POST`   | `/api/auth/logout`    |                                               |
| `GET`    | `/api/me`             |                                               |
| `GET`    | `/api/notes`          | `?view=all\|pinned\|trash&q=search words`     |
| `POST`   | `/api/notes`          | `{ title?, content? }`                        |
| `GET`    | `/api/notes/:id`      |                                               |
| `PATCH`  | `/api/notes/:id`      | any of `{ title, content, pinned, trashed }`  |
| `DELETE` | `/api/notes/:id`      | permanent                                     |
| `DELETE` | `/api/trash`          | empties the trash                             |
| `GET`    | `/api/health`         |                                               |

Errors look like `{ "status": 404, "message": "…" }`.

### Database changes

Migrations are the `migrations` array in `src/lib/server/db.ts`, tracked with SQLite's `user_version`. Add a new entry for each change; never edit one that has shipped.

## License

Inkwell is free software, licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). If you run a modified version for other people over a network, you must offer them its source code.
