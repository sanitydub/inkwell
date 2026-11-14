import { inflateRawSync } from 'node:zlib';

// A minimal zip reader (stored and deflated entries, no ZIP64 or encryption) for importing notes.
// Limits on entry count and unpacked size keep a malicious archive from exhausting the server.

export class ZipError extends Error {}

export interface UnzippedFile {
	path: string;
	data: Buffer;
	modified: Date;
}

export interface ZipLimits {
	maxFiles: number;
	maxTotalBytes: number;
}

const DEFAULT_LIMITS: ZipLimits = { maxFiles: 10_000, maxTotalBytes: 200 * 1024 * 1024 };

function fromDosDateTime(date: number, time: number): Date {
	return new Date(1980 + (date >> 9), ((date >> 5) & 0xf) - 1, date & 0x1f, time >> 11, (time >> 5) & 0x3f, (time & 0x1f) * 2);
}

/** Reads every file in a zip. Directories are left out; unsupported entries are listed in `skipped`. */
export function readZip(buf: Buffer, limits: ZipLimits = DEFAULT_LIMITS): { files: UnzippedFile[]; skipped: string[] } {
	// The end-of-central-directory record sits in the last 22 bytes plus an optional comment.
	let eocd = -1;
	for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new ZipError('This isn’t a zip file, or it’s damaged.');

	const count = buf.readUInt16LE(eocd + 10);
	const directoryOffset = buf.readUInt32LE(eocd + 16);
	if (count === 0xffff || directoryOffset === 0xffffffff) {
		throw new ZipError('This zip uses the ZIP64 format, which isn’t supported. Try a smaller archive.');
	}
	if (count > limits.maxFiles) throw new ZipError(`This zip has more than ${limits.maxFiles.toLocaleString('en')} files.`);

	const files: UnzippedFile[] = [];
	const skipped: string[] = [];
	let total = 0;
	let p = directoryOffset;

	for (let n = 0; n < count; n++) {
		if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('This zip file is damaged.');
		const flags = buf.readUInt16LE(p + 8);
		const method = buf.readUInt16LE(p + 10);
		const time = buf.readUInt16LE(p + 12);
		const date = buf.readUInt16LE(p + 14);
		const compressedSize = buf.readUInt32LE(p + 20);
		const size = buf.readUInt32LE(p + 24);
		const nameLength = buf.readUInt16LE(p + 28);
		const extraLength = buf.readUInt16LE(p + 30);
		const commentLength = buf.readUInt16LE(p + 32);
		const localOffset = buf.readUInt32LE(p + 42);
		const path = buf.toString('utf8', p + 46, p + 46 + nameLength).replaceAll('\\', '/');
		p += 46 + nameLength + extraLength + commentLength;

		if (path.endsWith('/')) continue;
		if (flags & 1) {
			skipped.push(`${path} (encrypted)`);
			continue;
		}
		if (method !== 0 && method !== 8) {
			skipped.push(`${path} (unsupported compression)`);
			continue;
		}

		total += size;
		if (total > limits.maxTotalBytes) {
			throw new ZipError(`This zip unpacks to more than ${Math.round(limits.maxTotalBytes / 1024 / 1024)} MB.`);
		}

		if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
			throw new ZipError('This zip file is damaged.');
		}
		const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
		const raw = buf.subarray(start, start + compressedSize);
		let data: Buffer;
		try {
			// maxOutputLength stops archives that lie about their unpacked size.
			data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
		} catch {
			throw new ZipError(`Couldn’t unpack “${path}”. The zip may be damaged.`);
		}
		files.push({ path, data, modified: fromDosDateTime(date, time) });
	}
	return { files, skipped };
}
