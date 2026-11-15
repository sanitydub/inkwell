// Per-device display preferences, kept in localStorage. Shared so the sidebar, the note toolbar
// and the command palette all change the same setting.

export type Theme = 'system' | 'light' | 'dark';

const THEME_KEY = 'inkwell-theme'; // also read by src/app.html before first paint
const SOURCE_KEY = 'inkwell-show-markdown';

export const THEME_LABELS: Record<Theme, string> = {
	system: 'Theme: match system',
	light: 'Theme: light',
	dark: 'Theme: dark'
};
const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };

function read(key: string): string | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string | null) {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		/* storage unavailable */
	}
}

class Preferences {
	theme = $state<Theme>('system');
	/** Plain Markdown source instead of the live view. */
	showMarkdown = $state(false);

	/** Reads the saved choices. Call once in the browser. */
	load() {
		const saved = read(THEME_KEY);
		this.theme = saved === 'light' || saved === 'dark' ? saved : 'system';
		this.showMarkdown = read(SOURCE_KEY) === 'true';
	}

	setTheme(theme: Theme) {
		this.theme = theme;
		const root = document.documentElement;
		if (theme === 'system') delete root.dataset.theme;
		else root.dataset.theme = theme;
		write(THEME_KEY, theme === 'system' ? null : theme);
	}

	cycleTheme() {
		this.setTheme(NEXT_THEME[this.theme]);
	}

	toggleShowMarkdown() {
		this.showMarkdown = !this.showMarkdown;
		write(SOURCE_KEY, String(this.showMarkdown));
	}
}

export const preferences = new Preferences();
