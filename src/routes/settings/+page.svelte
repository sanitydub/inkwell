<script lang="ts">
	import { onMount } from 'svelte';
	import { ChevronLeft } from '@lucide/svelte';
	import { api, ApiError } from '#lib/api.ts';
	import type { ApiToken, AttachmentUsage, ManagedUser, TokenScope } from '#lib/types.ts';

	let { data } = $props();
	const me = $derived(data.user);

	type Status = { ok: boolean; text: string } | null;

	const day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

	function failure(err: unknown): Status {
		if (err instanceof ApiError && err.status === 401) location.href = '/login';
		return { ok: false, text: err instanceof Error ? err.message : String(err) };
	}

	// ---- Password -----------------------------------------------------------------

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let changingPassword = $state(false);
	let passwordStatus = $state<Status>(null);

	async function changePassword(e: SubmitEvent) {
		e.preventDefault();
		passwordStatus = null;
		if (newPassword !== confirmPassword) {
			passwordStatus = { ok: false, text: 'The new passwords don’t match. Type the same password twice.' };
			return;
		}
		changingPassword = true;
		try {
			const { otherSessionsSignedOut: n } = await api.changePassword(currentPassword, newPassword);
			currentPassword = newPassword = confirmPassword = '';
			otherSessions = 0;
			passwordStatus = {
				ok: true,
				text: n ? `Password changed. Signed out ${plural(n, 'other device')}.` : 'Password changed.'
			};
		} catch (err) {
			passwordStatus = failure(err);
		} finally {
			changingPassword = false;
		}
	}

	// ---- Devices ------------------------------------------------------------------

	let otherSessions = $state<number | null>(null);
	let devicesStatus = $state<Status>(null);

	async function signOutOthers() {
		devicesStatus = null;
		try {
			const { signedOut } = await api.signOutOtherSessions();
			otherSessions = 0;
			devicesStatus = { ok: true, text: `Signed out ${plural(signedOut, 'other device')}.` };
		} catch (err) {
			devicesStatus = failure(err);
		}
	}

	// ---- Attachments ------------------------------------------------------------

	let attachments = $state<AttachmentUsage[] | null>(null);
	let attachmentsStatus = $state<Status>(null);
	const unused = $derived((attachments ?? []).filter((a) => !a.usedBy.length));
	const totalBytes = $derived((attachments ?? []).reduce((sum, a) => sum + a.size, 0));

	function formatBytes(bytes: number) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	async function loadAttachments() {
		try {
			attachments = (await api.listAttachments()).attachments;
		} catch (err) {
			attachmentsStatus = failure(err);
		}
	}

	async function deleteOneAttachment(a: AttachmentUsage) {
		const warning = a.usedBy.length
			? ` It’s used in ${plural(a.usedBy.length, 'note')}, which will show a broken link.`
			: '';
		if (!confirm(`Delete “${a.name}”?${warning} This can’t be undone.`)) return;
		attachmentsStatus = null;
		try {
			await api.deleteAttachment(a.id);
			attachments = (attachments ?? []).filter((x) => x.id !== a.id);
			attachmentsStatus = { ok: true, text: `Deleted “${a.name}”.` };
		} catch (err) {
			attachmentsStatus = failure(err);
		}
	}

	async function deleteUnused() {
		if (!confirm(`Delete ${plural(unused.length, 'unused attachment')}? No note links to them. This can’t be undone.`)) return;
		attachmentsStatus = null;
		try {
			const { deleted, freedBytes } = await api.deleteUnusedAttachments();
			await loadAttachments();
			attachmentsStatus = { ok: true, text: `Deleted ${plural(deleted, 'attachment')} and freed ${formatBytes(freedBytes)}.` };
		} catch (err) {
			attachmentsStatus = failure(err);
		}
	}

	// ---- People (admins) ----------------------------------------------------------

	let users = $state<ManagedUser[]>([]);
	// ---- API tokens ---------------------------------------------------------------

	let tokens = $state<ApiToken[] | null>(null);
	let tokensStatus = $state<Status>(null);
	let tokenName = $state('');
	let tokenScope = $state<TokenScope>('write');
	let tokenExpiry = $state('90');
	let creatingToken = $state(false);
	/** The secret of the token just created: shown once, until the page is left. */
	let newSecret = $state<{ id: string; secret: string } | null>(null);
	let copied = $state(false);

	async function createToken(e: SubmitEvent) {
		e.preventDefault();
		tokensStatus = null;
		creatingToken = true;
		try {
			const { token, secret } = await api.createToken(tokenName, tokenScope, tokenExpiry === 'never' ? null : Number(tokenExpiry));
			tokens = [token, ...(tokens ?? [])];
			newSecret = { id: token.id, secret };
			copied = false;
			tokenName = '';
		} catch (err) {
			tokensStatus = failure(err);
		} finally {
			creatingToken = false;
		}
	}

	async function copySecret() {
		if (!newSecret) return;
		try {
			await navigator.clipboard.writeText(newSecret.secret);
			copied = true;
		} catch {
			tokensStatus = { ok: false, text: 'Couldn’t copy. Select the token and copy it yourself.' };
		}
	}

	async function revokeToken(t: ApiToken) {
		if (!confirm(`Revoke “${t.name}”? Anything using it stops working straight away.`)) return;
		tokensStatus = null;
		try {
			await api.revokeToken(t.id);
			tokens = (tokens ?? []).filter((x) => x.id !== t.id);
			if (newSecret?.id === t.id) newSecret = null;
			tokensStatus = { ok: true, text: `Revoked “${t.name}”.` };
		} catch (err) {
			tokensStatus = failure(err);
		}
	}

	const tokenExpiryText = (t: ApiToken) =>
		t.expiresAt === null ? 'Never' : t.expiresAt <= Date.now() ? `Expired ${day.format(t.expiresAt)}` : day.format(t.expiresAt);

	let peopleStatus = $state<Status>(null);
	let newUsername = $state('');
	let newUserPassword = $state('');
	let newUserIsAdmin = $state(false);
	let creatingUser = $state(false);
	let resettingId = $state<string | null>(null);
	let resetPassword = $state('');

	onMount(async () => {
		try {
			otherSessions = (await api.countOtherSessions()).otherSessions;
		} catch (err) {
			devicesStatus = failure(err);
		}
		loadAttachments();
		api.listTokens().then(
			(r) => (tokens = r.tokens),
			(err) => (tokensStatus = failure(err))
		);
		if (me.isAdmin) {
			try {
				users = (await api.listUsers()).users;
			} catch (err) {
				peopleStatus = failure(err);
			}
		}
	});

	// Puts the cursor in the reset-password field as soon as it appears.
	const focusOnShow = (node: HTMLElement) => node.focus();

	const replaceUser = (updated: ManagedUser) => (users = users.map((u) => (u.id === updated.id ? updated : u)));

	async function createUser(e: SubmitEvent) {
		e.preventDefault();
		creatingUser = true;
		peopleStatus = null;
		try {
			const user = await api.createUser(newUsername.trim(), newUserPassword, newUserIsAdmin);
			users = [...users, user];
			peopleStatus = { ok: true, text: `Created an account for ${user.username}. Give them the password privately.` };
			newUsername = newUserPassword = '';
			newUserIsAdmin = false;
		} catch (err) {
			peopleStatus = failure(err);
		} finally {
			creatingUser = false;
		}
	}

	async function toggleAdmin(user: ManagedUser) {
		peopleStatus = null;
		try {
			const updated = await api.updateUser(user.id, { isAdmin: !user.isAdmin });
			replaceUser(updated);
			peopleStatus = {
				ok: true,
				text: updated.isAdmin ? `${user.username} is now an admin.` : `${user.username} is no longer an admin.`
			};
		} catch (err) {
			peopleStatus = failure(err);
		}
	}

	async function saveReset(e: SubmitEvent, user: ManagedUser) {
		e.preventDefault();
		peopleStatus = null;
		try {
			await api.updateUser(user.id, { password: resetPassword });
			resettingId = null;
			resetPassword = '';
			peopleStatus = { ok: true, text: `Set a new password for ${user.username} and signed them out everywhere.` };
		} catch (err) {
			peopleStatus = failure(err);
		}
	}

	async function deleteUser(user: ManagedUser) {
		const notes = user.noteCount ? ` and ${plural(user.noteCount, 'note')}` : '';
		if (!confirm(`Delete ${user.username}’s account${notes}? This can’t be undone.`)) return;
		peopleStatus = null;
		try {
			await api.deleteUser(user.id);
			users = users.filter((u) => u.id !== user.id);
			peopleStatus = { ok: true, text: `Deleted ${user.username}’s account.` };
		} catch (err) {
			peopleStatus = failure(err);
		}
	}
</script>

<svelte:head>
	<title>Settings – Inkwell</title>
</svelte:head>

{#snippet statusLine(status: Status)}
	{#if status}
		<p class="status" class:error={!status.ok} role={status.ok ? 'status' : 'alert'}>{status.text}</p>
	{/if}
{/snippet}

<main class="settings">
	<a class="back" href="/"><ChevronLeft size={18} /> Back to notes</a>
	<h1>Settings</h1>

	<section aria-labelledby="account-heading">
		<h2 id="account-heading">Account</h2>
		<p>
			Signed in as <strong>{me.username}</strong>
			{#if me.isAdmin}<span class="badge">Admin</span>{/if}
			<br />
			<span class="muted">Member since {day.format(me.createdAt)}</span>
		</p>
	</section>

	<section aria-labelledby="password-heading">
		<h2 id="password-heading">Password</h2>
		<p class="muted">Changing your password signs you out on your other devices.</p>
		<form class="fields" onsubmit={changePassword}>
			<label>
				<span>Current password</span>
				<input type="password" autocomplete="current-password" required bind:value={currentPassword} />
			</label>
			<label>
				<span>New password</span>
				<input type="password" autocomplete="new-password" minlength="8" required bind:value={newPassword} />
				<small>At least 8 characters.</small>
			</label>
			<label>
				<span>Confirm new password</span>
				<input type="password" autocomplete="new-password" minlength="8" required bind:value={confirmPassword} />
			</label>
			{@render statusLine(passwordStatus)}
			<div>
				<button class="btn primary" disabled={changingPassword}>
					{changingPassword ? 'Changing password…' : 'Change password'}
				</button>
			</div>
		</form>
	</section>

	<section aria-labelledby="devices-heading">
		<h2 id="devices-heading">Devices</h2>
		<p>
			{#if otherSessions === null}
				Checking where you’re signed in…
			{:else if otherSessions === 0}
				This is the only device signed in to your account.
			{:else}
				You’re also signed in on {plural(otherSessions, 'other device')}.
			{/if}
		</p>
		<button class="btn" disabled={!otherSessions} onclick={signOutOthers}>Sign out other devices</button>
		{@render statusLine(devicesStatus)}
	</section>

	<section aria-labelledby="tokens-heading">
		<h2 id="tokens-heading">API tokens</h2>
		<p class="muted">
			Let scripts and apps use your notes through the API by sending
			<code>Authorization: Bearer &lt;token&gt;</code>. A token can do what you can, except change account settings,
			tokens or other accounts. Read-only tokens can’t change anything.
		</p>

		{#if newSecret}
			<div class="secret" role="status">
				<p><strong>Copy this token now.</strong> It won’t be shown again.</p>
				<div class="secret-row">
					<input readonly value={newSecret.secret} aria-label="New API token" onfocus={(e) => e.currentTarget.select()} />
					<button class="btn" onclick={copySecret}>{copied ? 'Copied' : 'Copy'}</button>
				</div>
			</div>
		{/if}

		{#if tokens === null}
			<p>Loading…</p>
		{:else if tokens.length}
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">Access</th>
							<th scope="col">Last used</th>
							<th scope="col">Expires</th>
							<th scope="col"><span class="visually-hidden">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each tokens as t (t.id)}
							<tr>
								<td>{t.name} <span class="muted token-end">…{t.lastFour}</span></td>
								<td>{t.scope === 'read' ? 'Read only' : 'Read & write'}</td>
								<td class:muted={!t.lastUsedAt}>{t.lastUsedAt ? day.format(t.lastUsedAt) : 'Never'}</td>
								<td class:expired={t.expiresAt !== null && t.expiresAt <= Date.now()}>{tokenExpiryText(t)}</td>
								<td class="actions"><button class="btn danger" onclick={() => revokeToken(t)}>Revoke</button></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<form class="fields token-form" onsubmit={createToken}>
			<label>
				<span>Token name</span>
				<input bind:value={tokenName} maxlength="60" required placeholder="e.g. Phone app, backup script" />
			</label>
			<label>
				<span>Access</span>
				<select bind:value={tokenScope}>
					<option value="write">Read & write</option>
					<option value="read">Read only</option>
				</select>
			</label>
			<label>
				<span>Expires</span>
				<select bind:value={tokenExpiry}>
					<option value="30">In 30 days</option>
					<option value="90">In 90 days</option>
					<option value="365">In a year</option>
					<option value="never">Never</option>
				</select>
			</label>
			<div>
				<button class="btn primary" disabled={creatingToken}>{creatingToken ? 'Creating…' : 'Create token'}</button>
			</div>
		</form>
		{@render statusLine(tokensStatus)}
	</section>

	<section aria-labelledby="attachments-heading">
		<h2 id="attachments-heading">Attachments</h2>
		<p class="muted">Images and files you paste or drop into notes. Only you can open them.</p>
		{#if attachments === null}
			<p>Loading…</p>
		{:else if !attachments.length}
			<p>No attachments yet. Paste or drop an image or file into a note to add one.</p>
		{:else}
			<p>
				{plural(attachments.length, 'file')}, {formatBytes(totalBytes)} in total.
				{#if unused.length}{plural(unused.length, 'file')} {unused.length === 1 ? 'isn’t' : 'aren’t'} used in any note.{/if}
			</p>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th scope="col">File</th>
							<th scope="col" class="num">Size</th>
							<th scope="col">Used in</th>
							<th scope="col"><span class="visually-hidden">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each attachments as a (a.id)}
							<tr>
								<td class="file"><a href={a.url} target="_blank" rel="noopener">{a.name}</a></td>
								<td class="num">{formatBytes(a.size)}</td>
								<td class="used" class:muted={!a.usedBy.length}>
									{a.usedBy.length
										? a.usedBy.map((n) => (n.title.trim() || 'Untitled') + (n.history ? ' (history)' : '')).join(', ')
										: 'Not used'}
								</td>
								<td class="actions"><button class="btn danger" onclick={() => deleteOneAttachment(a)}>Delete</button></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="after-table">
				<button class="btn" disabled={!unused.length} onclick={deleteUnused}>
					Delete unused{unused.length ? ` (${unused.length})` : ''}
				</button>
			</div>
		{/if}
		{@render statusLine(attachmentsStatus)}
	</section>

	{#if me.isAdmin}
		<section aria-labelledby="people-heading">
			<h2 id="people-heading">People on this server</h2>
			<p class="muted">
				{#if data.signupsOpen}
					Anyone who can reach this server can create an account. To stop that, set
					<code>ALLOW_REGISTRATION=false</code>; you can still add people here.
				{:else}
					New sign-ups are turned off, so add people here.
				{/if}
			</p>

			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th scope="col">Username</th>
							<th scope="col" class="num">Notes</th>
							<th scope="col">Joined</th>
							<th scope="col"><span class="visually-hidden">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each users as user (user.id)}
							<tr>
								<td>
									{user.username}
									{#if user.isAdmin}<span class="badge">Admin</span>{/if}
									{#if user.id === me.id}<span class="muted">(you)</span>{/if}
								</td>
								<td class="num">{user.noteCount}</td>
								<td>{day.format(user.createdAt)}</td>
								<td class="actions">
									{#if user.id !== me.id}
										{#if resettingId === user.id}
											<form class="reset" onsubmit={(e) => saveReset(e, user)}>
												<input
													use:focusOnShow
													type="password"
													aria-label="New password for {user.username}"
													placeholder="New password"
													autocomplete="new-password"
													minlength="8"
													required
													bind:value={resetPassword}
												/>
												<button class="btn primary">Set password</button>
												<button type="button" class="btn" onclick={() => (resettingId = null)}>Cancel</button>
											</form>
										{:else}
											<button
												class="btn"
												onclick={() => {
													resettingId = user.id;
													resetPassword = '';
												}}>Reset password</button
											>
											<button class="btn" onclick={() => toggleAdmin(user)}>
												{user.isAdmin ? 'Remove admin' : 'Make admin'}
											</button>
											<button class="btn danger" onclick={() => deleteUser(user)}>Delete</button>
										{/if}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{@render statusLine(peopleStatus)}

			<h3>Add a person</h3>
			<form class="fields" onsubmit={createUser}>
				<label>
					<span>Username</span>
					<input
						autocomplete="off"
						autocapitalize="none"
						spellcheck="false"
						minlength="3"
						maxlength="32"
						required
						bind:value={newUsername}
					/>
				</label>
				<label>
					<span>Password</span>
					<input type="password" autocomplete="new-password" minlength="8" required bind:value={newUserPassword} />
					<small>At least 8 characters. They can change it in Settings.</small>
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={newUserIsAdmin} />
					<span>Make them an admin</span>
				</label>
				<div>
					<button class="btn primary" disabled={creatingUser}>
						{creatingUser ? 'Creating account…' : 'Create account'}
					</button>
				</div>
			</form>
		</section>
	{/if}
</main>

<style>
	.settings {
		max-width: 48rem;
		margin: 0 auto;
		padding: 1.25rem 1.5rem 5rem;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-left: -0.35rem;
		padding: 0.3rem 0.5rem 0.3rem 0.25rem;
		border-radius: var(--radius);
		color: var(--muted);
		font-size: 0.9rem;
		text-decoration: none;
	}
	.back:hover {
		background: var(--panel);
		color: var(--ink);
	}
	h1 {
		margin: 1.25rem 0 0.5rem;
		font-size: clamp(1.7rem, 1.2rem + 1.3vw, 2.3rem);
		font-weight: 650;
		letter-spacing: -0.02em;
	}
	section {
		padding: 1.75rem 0;
		border-top: 1px solid var(--line);
	}
	section:first-of-type {
		border-top: 0;
	}
	h2 {
		margin: 0 0 0.5rem;
		font-size: 1.05rem;
		font-weight: 600;
	}
	h3 {
		margin: 2rem 0 0.75rem;
		font-size: 0.95rem;
		font-weight: 600;
	}
	p {
		margin: 0 0 1rem;
		max-width: 60ch;
		line-height: 1.55;
	}
	.muted {
		color: var(--muted);
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.85em;
		background: var(--code-bg);
		padding: 0.1em 0.35em;
		border-radius: 4px;
	}
	.badge {
		display: inline-block;
		margin-left: 0.35rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 0.75rem;
		font-weight: 600;
		vertical-align: 0.1em;
	}

	.fields {
		display: grid;
		gap: 1rem;
		max-width: 22rem;
	}
	label {
		display: grid;
		gap: 0.35rem;
	}
	label > span {
		font-size: 0.875rem;
		font-weight: 600;
	}
	input:not([type='checkbox']),
	select {
		height: 2.4rem;
		padding: 0 0.75rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--paper);
	}
	input:not([type='checkbox']):focus,
	select:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.check span {
		font-weight: 500;
	}
	input[type='checkbox'] {
		width: 1rem;
		height: 1rem;
		accent-color: var(--accent);
	}
	small {
		color: var(--muted);
		font-size: 0.8rem;
	}
	.token-form {
		margin-top: 1.25rem;
	}
	.token-end {
		font-family: var(--font-mono);
		font-size: 0.8rem;
	}
	.expired {
		color: var(--danger);
	}
	.secret {
		margin: 0 0 1rem;
		padding: 0.75rem 0.9rem;
		border: 1px solid var(--accent);
		border-radius: var(--radius);
		background: var(--accent-soft);
	}
	.secret p {
		margin: 0 0 0.5rem;
		font-size: 0.9rem;
	}
	.secret-row {
		display: flex;
		gap: 0.5rem;
	}
	.secret-row input {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: 0.8rem;
	}
	.secret-row .btn {
		height: 2.4rem;
	}

	.status {
		margin: 0.75rem 0 0;
		padding: 0.55rem 0.8rem;
		border-radius: var(--radius);
		background: var(--accent-soft);
		color: var(--ink);
		font-size: 0.875rem;
	}
	.status.error {
		background: var(--danger-soft);
		color: var(--danger);
	}

	.table-wrap {
		overflow-x: auto;
		margin: 0 -0.5rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	th {
		padding: 0.5rem;
		color: var(--muted);
		font-size: 0.8rem;
		font-weight: 600;
		text-align: left;
		border-bottom: 1px solid var(--line);
	}
	td {
		padding: 0.6rem 0.5rem;
		border-bottom: 1px solid var(--line);
		white-space: nowrap;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.actions {
		text-align: right;
	}
	.actions .btn {
		height: 1.85rem;
		padding: 0 0.6rem;
		font-size: 0.8rem;
	}
	.file a {
		color: var(--accent);
		text-decoration-thickness: 1px;
		text-underline-offset: 0.15em;
	}
	.file,
	.used {
		max-width: 16rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.after-table {
		margin-top: 0.75rem;
	}
	.reset {
		display: inline-flex;
		gap: 0.35rem;
	}
	.reset input {
		height: 1.85rem;
		width: 10rem;
		font-size: 0.85rem;
	}
</style>
