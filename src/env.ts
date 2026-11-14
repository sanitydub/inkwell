import { defineEnvVars } from '@sveltejs/kit/env';

const TRUE = ['true', '1', 'yes', 'on'];
const FALSE = ['false', '0', 'no', 'off'];

export const variables = defineEnvVars({
	DATA_DIR: {
		description: 'Folder that holds the SQLite database. Created if missing.',
		schema: (value) => value?.trim() || 'data'
	},
	ALLOW_REGISTRATION: {
		description: 'Whether anyone can create an account. The first account is always allowed.',
		schema: (value) => {
			const v = value?.trim().toLowerCase();
			if (!v || TRUE.includes(v)) return true;
			if (FALSE.includes(v)) return false;
			throw new Error(`ALLOW_REGISTRATION must be true or false, got "${value}"`);
		}
	}
});
