// Regenerates the README screenshots in docs/screenshots/.
//
//   npm run screenshots
//
// Builds the app, starts it on a free port with a throwaway database, fills a demo account with
// sample notes, and captures pages with a Chromium-based browser (Brave, Chrome, Chromium or Edge).
// Set BROWSER_PATH to point at a specific browser. Your own browser profile is never touched.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = resolve('docs/screenshots');

const BROWSERS = [
	process.env.BROWSER_PATH,
	'/opt/brave.com/brave-origin/brave',
	'/opt/brave.com/brave/brave',
	'/usr/bin/brave-browser',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
	'/usr/bin/chromium-browser',
	'/usr/bin/microsoft-edge',
	'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
	'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
	'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
].filter(Boolean);

// ---- Demo content --------------------------------------------------------------------------
// Listed oldest first; the last note created shows at the top of the list.

const NOTEBOOKS = ['Garden', 'Work', 'Reading'];

const NOTES = [
	{
		title: 'Sourdough starter',
		content:
			'Feed daily at 9am: 50 g flour, 50 g water. #recipes\n\nIf it smells like nail polish, it’s hungry. Feed twice a day for a few days.'
	},
	{
		title: 'Books to read',
		notebook: 'Reading',
		content:
			'## Next up\n\n1. *The Overstory*\n2. *Piranesi*\n3. *A Psalm for the Wild-Built*\n\n## Finished\n\n- *Braiding Sweetgrass* (loved the chapter on strawberries) #favourites'
	},
	{
		title: 'One-on-one with Sam',
		notebook: 'Work',
		content:
			'- Wants more time on the sync engine\n- Pair on the import feature next sprint\n- [ ] Share the [[Q1 roadmap]] draft before Friday #work/people'
	},
	{
		title: 'Q1 roadmap',
		notebook: 'Work',
		content:
			'## Themes\n\n- Faster search on large vaults\n- Native app beta\n- Import from Joplin and Obsidian\n\n- [x] Draft goals\n- [ ] Review with the team #work/planning'
	},
	{
		title: 'Seed order',
		notebook: 'Garden',
		content:
			'For the [[Spring planting plan]]. #garden/veg\n\n| Seed | Packets |\n|---|---|\n| Tomato ‘Sungold’ | 2 |\n| Basil ‘Genovese’ | 1 |\n| Runner bean | 1 |'
	},
	{
		title: 'Spring planting plan',
		notebook: 'Garden',
		pinned: true,
		content: [
			'## Beds',
			'',
			'Move the **tomatoes** to the south bed this year and try `companion planting` with basil. Quantities are in the [[Seed order]]. #garden/veg',
			'',
			'==Order seeds before March==, or the <u>Sungold</u> tomatoes sell out.',
			'',
			'> Water deeply, not daily.',
			'',
			'## This weekend',
			'',
			'- [x] Turn the compost',
			'- [ ] Build the bean trellis',
			'- [ ] Sow basil indoors',
			'',
			'## Notes',
			'',
			'Last frost is usually mid-April. Harden off seedlings for a week before planting out. #garden/schedule'
		].join('\n')
	}
];

// ---- Helpers -------------------------------------------------------------------------------

function findBrowser() {
	const path = BROWSERS.find((p) => existsSync(p));
	if (!path) {
		console.error('No Chromium-based browser found. Install Chrome, Chromium, Brave or Edge, or set BROWSER_PATH.');
		process.exit(1);
	}
	return path;
}

function freePort() {
	return new Promise((ok) => {
		const server = createServer().listen(0, () => {
			const { port } = server.address();
			server.close(() => ok(port));
		});
	});
}

async function waitForServer(base) {
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(`${base}/api/health`)).ok) return;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error('The app didn’t start.');
}

async function seed(base) {
	const register = await fetch(`${base}/api/auth/register`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ username: 'maya', password: 'demo-password-only' })
	});
	if (!register.ok) throw new Error(`Couldn’t create the demo account (${register.status}).`);
	const token = /inkwell_session=([^;]+)/.exec(register.headers.get('set-cookie') ?? '')?.[1];

	const call = async (method, path, body) => {
		const res = await fetch(`${base}/api${path}`, {
			method,
			headers: { 'content-type': 'application/json', cookie: `inkwell_session=${token}` },
			body: JSON.stringify(body)
		});
		if (!res.ok) throw new Error(`${method} ${path} failed (${res.status})`);
		return res.json();
	};

	const notebookIds = {};
	for (const name of NOTEBOOKS) notebookIds[name] = (await call('POST', '/notebooks', { name })).id;

	const noteIds = {};
	for (const note of NOTES) {
		const created = await call('POST', '/notes', {
			title: note.title,
			content: note.content,
			notebookId: note.notebook ? notebookIds[note.notebook] : null
		});
		if (note.pinned) await call('PATCH', `/notes/${created.id}`, { pinned: true });
		noteIds[note.title] = created.id;
		await new Promise((r) => setTimeout(r, 15)); // distinct "last edited" times
	}
	// A second person, so the admin's People table on the settings page has something to show.
	await call('POST', '/admin/users', { username: 'sam', password: 'demo-password-only' });
	return { token, noteIds };
}

async function capture(browser, base, token, { file, width, height, scale, theme, path, before, fullPage = false }) {
	const page = await browser.newPage();
	await page.setViewport({ width, height, deviceScaleFactor: scale, isMobile: width < 760, hasTouch: width < 760 });
	await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
	await page.setCookie({ name: 'inkwell_session', value: token, url: base });
	await page.evaluateOnNewDocument(
		(theme) => localStorage.setItem('inkwell-theme', theme),
		theme
	);
	await page.goto(`${base}${path}`, { waitUntil: 'networkidle0' });
	await page.evaluate(() => document.fonts.ready);
	if (before) await before(page);
	await new Promise((r) => setTimeout(r, 300));
	await page.screenshot({ path: join(OUT, file), fullPage });
	await page.close();
	console.log(`  docs/screenshots/${file}`);
}

// ---- Main ----------------------------------------------------------------------------------

const executablePath = findBrowser();
const port = await freePort();
const base = `http://localhost:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'inkwell-screenshots-'));
const server = spawn(process.execPath, ['build'], {
	env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ORIGIN: base, ALLOW_REGISTRATION: 'true' },
	stdio: ['ignore', 'ignore', 'inherit']
});

let browser;
try {
	await waitForServer(base);
	const { token, noteIds } = await seed(base);
	mkdirSync(OUT, { recursive: true });
	browser = await puppeteer.launch({ executablePath, headless: true });
	console.log(`Capturing with ${executablePath}:`);

	const plan = `/?note=${noteIds['Spring planting plan']}`;
	await capture(browser, base, token, { file: 'desktop-light.png', width: 1440, height: 860, scale: 2, theme: 'light', path: plan });
	await capture(browser, base, token, {
		file: 'desktop-dark.png',
		width: 1440,
		height: 860,
		scale: 2,
		theme: 'dark',
		
		path: `/?note=${noteIds['Seed order']}`,
		// Show the backlinks list.
		before: (page) => page.click('.backlinks .pill')
	});
	await capture(browser, base, token, {
		file: 'settings.png',
		width: 1100,
		height: 700,
		scale: 2,
		theme: 'light',
		
		path: '/settings',
		fullPage: true
	});
	await capture(browser, base, token, { file: 'mobile-list.png', width: 390, height: 844, scale: 3, theme: 'light', path: '/' });
	await capture(browser, base, token, { file: 'mobile-note.png', width: 390, height: 844, scale: 3, theme: 'dark', path: plan });
} finally {
	await browser?.close();
	server.kill();
	rmSync(dataDir, { recursive: true, force: true });
}
