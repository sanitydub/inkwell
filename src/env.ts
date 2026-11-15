import { defineEnvVars } from '@sveltejs/kit/env';

const TRUE = ['true', '1', 'yes', 'on'];
const FALSE = ['false', '0', 'no', 'off'];

export const variables = defineEnvVars({
	DATA_DIR: {
		description: 'Folder that holds the SQLite database. Created if missing.',
		schema: (value) => value?.trim() || 'data'
	},
	MAX_ATTACHMENT_SIZE: {
		description: 'Largest attachment (image or file) one upload may be, e.g. "10M" or "500K". Default 10M.',
		schema: (value) => {
			const v = value?.trim();
			if (!v) return 10 * 1024 * 1024;
			const m = /^(\d+(?:\.\d+)?)\s*([kmg]?)b?$/i.exec(v);
			if (!m) throw new Error(`MAX_ATTACHMENT_SIZE must look like 10M, 500K or 2G, got "${value}"`);
			const unit = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2].toLowerCase() as '' | 'k' | 'm' | 'g'];
			return Math.floor(Number(m[1]) * unit);
		}
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
