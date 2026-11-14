// In-memory attempt counters for sign-in and sign-up. They reset when the server restarts,
// which is fine for slowing down password guessing on a single self-hosted instance.

const MINUTE = 60_000;

export class AttemptLimiter {
	#hits = new Map<string, number[]>();

	constructor(
		private readonly max: number,
		private readonly windowMs: number
	) {}

	/** Milliseconds until `key` may try again, or 0 if it may try now. */
	retryAfter(key: string, now = Date.now()): number {
		const hits = this.#recent(key, now);
		return hits.length >= this.max ? hits[0] + this.windowMs - now : 0;
	}

	record(key: string, now = Date.now()) {
		const hits = this.#recent(key, now);
		hits.push(now);
		this.#hits.set(key, hits);
		if (this.#hits.size > 10_000) this.#prune(now);
	}

	reset(key: string) {
		this.#hits.delete(key);
	}

	#recent(key: string, now: number) {
		return (this.#hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
	}

	#prune(now: number) {
		for (const [key, hits] of this.#hits) {
			if (!hits.some((t) => now - t < this.windowMs)) this.#hits.delete(key);
		}
	}
}

/** Failed sign-ins from one IP address (covers guessing many usernames). */
export const failedLoginsByIp = new AttemptLimiter(20, 15 * MINUTE);
/** Failed sign-ins for one username (covers guessing from many addresses). */
export const failedLoginsByUser = new AttemptLimiter(10, 15 * MINUTE);
/** Accounts created from one IP address. */
export const signupsByIp = new AttemptLimiter(5, 60 * MINUTE);
