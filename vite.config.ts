import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter(),
			// The cross-site check lives in src/hooks.server.ts instead, so API tokens can skip it.
			csrf: { trustedOrigins: ['*'] }
		})
	]
});
