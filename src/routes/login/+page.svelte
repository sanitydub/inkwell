<script lang="ts">
	import { api, ApiError } from '#lib/api.ts';

	let { data } = $props();

	// Only the initial value matters; the user can switch modes afterwards.
	// svelte-ignore state_referenced_locally
	let mode = $state<'signin' | 'register'>(data.firstRun ? 'register' : 'signin');
	let username = $state('');
	let password = $state('');
	let busy = $state(false);
	let problem = $state<string | null>(null);

	const registering = $derived(mode === 'register');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		problem = null;
		try {
			if (registering) await api.register(username, password);
			else await api.login(username, password);
			location.href = '/';
		} catch (err) {
			problem = err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
			busy = false;
		}
	}

	function switchMode() {
		mode = registering ? 'signin' : 'register';
		problem = null;
	}
</script>

<svelte:head>
	<title>{registering ? 'Create account' : 'Sign in'} – Inkwell</title>
</svelte:head>

<main>
	<div class="card">
		<h1>Inkwell</h1>
		<p class="lede">
			{#if data.firstRun}
				Create the first account on this server to start writing.
			{:else if registering}
				Create an account. Your notes are visible only to you.
			{:else}
				Sign in to your notes.
			{/if}
		</p>

		<form onsubmit={submit}>
			<label>
				<span>Username</span>
				<input
					name="username"
					bind:value={username}
					autocomplete="username"
					autocapitalize="none"
					spellcheck="false"
					required
					minlength={registering ? 3 : undefined}
					maxlength="32"
				/>
			</label>
			<label>
				<span>Password</span>
				<input
					name="password"
					type="password"
					bind:value={password}
					autocomplete={registering ? 'new-password' : 'current-password'}
					required
					minlength={registering ? 8 : undefined}
				/>
				{#if registering}<small>At least 8 characters.</small>{/if}
			</label>

			{#if problem}
				<p class="problem" role="alert">{problem}</p>
			{/if}

			<button class="btn primary submit" disabled={busy}>
				{#if busy}
					{registering ? 'Creating account…' : 'Signing in…'}
				{:else}
					{registering ? 'Create account' : 'Sign in'}
				{/if}
			</button>
		</form>

		{#if !data.firstRun && data.registrationOpen}
			<p class="switch">
				{registering ? 'Already have an account?' : 'New here?'}
				<button type="button" onclick={switchMode}>{registering ? 'Sign in' : 'Create an account'}</button>
			</p>
		{/if}
	</div>
</main>

<style>
	main {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 2rem 1rem;
	}
	.card {
		width: 100%;
		max-width: 22rem;
	}
	h1 {
		margin: 0;
		font-family: var(--font-serif);
		font-optical-sizing: auto;
		font-style: italic;
		font-weight: 450;
		font-size: 3.25rem;
		line-height: 1;
		letter-spacing: -0.02em;
	}
	.lede {
		margin: 0.75rem 0 2rem;
		color: var(--muted);
	}
	form {
		display: grid;
		gap: 1rem;
	}
	label {
		display: grid;
		gap: 0.35rem;
	}
	label span {
		font-size: 0.875rem;
		font-weight: 600;
	}
	input {
		height: 2.5rem;
		padding: 0 0.75rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--paper);
	}
	input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}
	small {
		color: var(--muted);
		font-size: 0.8rem;
	}
	.problem {
		margin: 0;
		padding: 0.6rem 0.8rem;
		border-radius: var(--radius);
		background: var(--danger-soft);
		color: var(--danger);
		font-size: 0.875rem;
	}
	.submit {
		height: 2.5rem;
		justify-content: center;
		margin-top: 0.25rem;
		font-size: 0.95rem;
	}
	.switch {
		margin: 1.5rem 0 0;
		color: var(--muted);
		font-size: 0.875rem;
	}
	.switch button {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}
</style>
