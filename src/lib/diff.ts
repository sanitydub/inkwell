// A small line diff for version history: longest common subsequence over the lines that differ
// after trimming the shared start and end. Very large changes fall back to "all removed, all added".

export interface DiffLine {
	type: 'same' | 'add' | 'del';
	text: string;
}

/** Above this many line pairs (after trimming) the diff stops looking for a fine-grained match. */
const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
	const a = before.split('\n');
	const b = after.split('\n');

	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let end = 0;
	while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;

	const head = a.slice(0, start).map((text): DiffLine => ({ type: 'same', text }));
	const tail = a.slice(a.length - end).map((text): DiffLine => ({ type: 'same', text }));
	const x = a.slice(start, a.length - end);
	const y = b.slice(start, b.length - end);
	return [...head, ...middle(x, y), ...tail];
}

function middle(x: string[], y: string[]): DiffLine[] {
	const n = x.length;
	const m = y.length;
	if (!n || !m || n * m > MAX_CELLS) {
		return [...x.map((text): DiffLine => ({ type: 'del', text })), ...y.map((text): DiffLine => ({ type: 'add', text }))];
	}
	// lcs[i][j] = length of the longest common subsequence of x[i..] and y[j..].
	const width = m + 1;
	const lcs = new Uint32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i * width + j] =
				x[i] === y[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
		}
	}
	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (x[i] === y[j]) {
			out.push({ type: 'same', text: x[i] });
			i++;
			j++;
		} else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
			out.push({ type: 'del', text: x[i++] });
		} else {
			out.push({ type: 'add', text: y[j++] });
		}
	}
	while (i < n) out.push({ type: 'del', text: x[i++] });
	while (j < m) out.push({ type: 'add', text: y[j++] });
	return out;
}

export type DiffChunk = DiffLine | { type: 'skip'; count: number };

/** Hides long runs of unchanged lines, keeping `context` lines around each change. */
export function collapseUnchanged(lines: DiffLine[], context = 2): DiffChunk[] {
	const keep = new Uint8Array(lines.length);
	lines.forEach((line, i) => {
		if (line.type === 'same') return;
		for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = 1;
	});
	const out: DiffChunk[] = [];
	let skipped = 0;
	lines.forEach((line, i) => {
		if (keep[i]) {
			if (skipped) out.push({ type: 'skip', count: skipped });
			skipped = 0;
			out.push(line);
		} else skipped++;
	});
	if (skipped) out.push({ type: 'skip', count: skipped });
	return out;
}
