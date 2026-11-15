// Fuzzy matching for the quick switcher and command palette: the typed letters must appear in
// order, and matches at the start of words and runs of consecutive letters rank higher.

export interface FuzzyMatch {
	score: number;
	/** Indexes of the matched characters, for highlighting. */
	positions: number[];
}

const isWordStart = (text: string, i: number) => i === 0 || /[\s\-_/.,:;()[\]'"#]/.test(text[i - 1]);

/** Scores `text` against `query`, or returns null if it doesn't match. Case is ignored; spaces in the query are skipped. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
	const q = query.toLowerCase().replace(/\s+/g, '');
	if (!q) return { score: 0, positions: [] };
	const t = text.toLowerCase();

	// Greedy left-to-right, but prefer a word-start occurrence of each letter when one is ahead.
	const positions: number[] = [];
	let from = 0;
	for (const ch of q) {
		let found = -1;
		for (let i = from; i < t.length; i++) {
			if (t[i] !== ch) continue;
			if (found < 0) found = i;
			// Keep a consecutive match over jumping to a later word start.
			if (positions.length && i === positions[positions.length - 1] + 1) {
				found = i;
				break;
			}
			if (isWordStart(text, i)) {
				found = i;
				break;
			}
		}
		if (found < 0) return null;
		positions.push(found);
		from = found + 1;
	}

	let score = 0;
	positions.forEach((p, i) => {
		score += 1;
		if (isWordStart(text, p)) score += 8;
		if (i > 0 && p === positions[i - 1] + 1) score += 5;
		if (i > 0) score -= Math.min(p - positions[i - 1] - 1, 10) * 0.5;
	});
	if (positions[0] === 0) score += 6;
	if (t === q) score += 30;
	else if (t.startsWith(q)) score += 15;
	// Among equal matches, shorter text is the closer fit.
	score -= text.length * 0.02;
	return { score, positions };
}

/** Items matching `query`, best first. Ties keep their original order. */
export function fuzzyFilter<T>(items: T[], query: string, textOf: (item: T) => string): { item: T; match: FuzzyMatch }[] {
	const out: { item: T; match: FuzzyMatch; index: number }[] = [];
	items.forEach((item, index) => {
		const match = fuzzyMatch(query, textOf(item));
		if (match) out.push({ item, match, index });
	});
	if (query.trim()) out.sort((a, b) => b.match.score - a.match.score || a.index - b.index);
	return out.map(({ item, match }) => ({ item, match }));
}
