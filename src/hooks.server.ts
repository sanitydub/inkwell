import { json, type RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, clearSessionCookie, setSessionCookie, validateSession } from '#lib/server/auth.ts';
import { tooManyAttempts } from '#lib/server/http.ts';
import { failedLoginsByIp } from '#lib/server/rate-limit.ts';
import { looksLikeToken, validateToken } from '#lib/server/tokens.ts';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Account settings, tokens and other people's accounts need a signed-in session, never a token. */
const SESSION_ONLY = /^\/api\/(admin|me\/(password|sessions|tokens))(\/|$)/;
const FORM_TYPES = /^(application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)\b/i;

const fail = (status: number, message: string) => json({ status, message }, { status });

/**
 * Cross-site request forgery check for cookie sessions (SvelteKit's own check is turned off in
 * vite.config.ts because it runs before this hook and would also block API tokens). Requests that
 * change data must come from this site. Browsers always send Origin on cross-site requests; when it's
 * missing, only a JSON body is allowed through, since a page on another site can't send JSON here
 * without the browser asking this server first (and it doesn't allow that).
 */
function isCrossSite(event: RequestEvent): boolean {
	const { request, url } = event;
	if (!UNSAFE.has(request.method)) return false;
	const origin = request.headers.get('origin');
	if (origin === url.origin) return false;
	if (origin !== null) return true;
	const type = request.headers.get('content-type');
	return !type || FORM_TYPES.test(type);
}

/** Signs a request in with "Authorization: Bearer <token>". Returns a response to send instead, if refused. */
function useToken(event: RequestEvent, header: string): Response | null {
	const ip = event.getClientAddress();
	const wait = failedLoginsByIp.retryAfter(ip);
	if (wait) return tooManyAttempts(wait, 'failed sign-in attempts');

	const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
	if (!match) return fail(401, 'Send an API token as "Authorization: Bearer <token>".');
	const found = looksLikeToken(match[1]) ? validateToken(match[1]) : null;
	if (!found) {
		failedLoginsByIp.record(ip);
		return fail(401, 'This API token isn’t valid. It may have expired or been revoked.');
	}
	if (SESSION_ONLY.test(event.url.pathname)) {
		return fail(403, 'API tokens can’t change account settings, tokens or other accounts. Sign in on the website to do that.');
	}
	if (found.scope === 'read' && !READ_ONLY.has(event.request.method)) {
		return fail(403, 'This API token is read-only.');
	}
	event.locals.user = found.user;
	event.locals.tokenScope = found.scope;
	return null;
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.sessionToken = null;
	event.locals.tokenScope = null;

	// API tokens: the cookie is ignored, and no cross-site check is needed because browsers never
	// attach an Authorization header to a request on their own.
	const authorization = event.request.headers.get('authorization');
	if (authorization !== null && event.url.pathname.startsWith('/api/')) {
		return useToken(event, authorization) ?? resolve(event);
	}

	if (isCrossSite(event)) return fail(403, `Cross-site ${event.request.method} requests are forbidden.`);

	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const session = validateSession(token);
		if (session) {
			event.locals.user = session.user;
			event.locals.sessionToken = token;
			if (session.renewed) setSessionCookie(event, token, session.expiresAt);
		} else {
			clearSessionCookie(event);
		}
	}

	return resolve(event);
};
