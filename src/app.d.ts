import type { User } from '#lib/types.ts';

declare global {
	namespace App {
		interface Locals {
			user: User | null;
			sessionToken: string | null;
			/** Set when the request signed in with an API token instead of a session. */
			tokenScope: import('#lib/types.ts').TokenScope | null;
		}
	}
}

export {};
