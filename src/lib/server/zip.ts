import { crc32, deflateRawSync } from 'node:zlib';

// A minimal zip writer (deflate, UTF-8 names, no ZIP64): enough for exporting notes without a dependency.

export interface ZipEntry {
	path: string;
	data: string | Uint8Array;
	modified: Date;
}

function dosDateTime(d: Date) {
	const year = Math.max(d.getFullYear(), 1980);
	return {
		time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
		date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
	};
}

const UTF8_NAMES = 0x0800;
const DEFLATE = 8;
const VERSION = 20;

export function createZip(entries: ZipEntry[]): Buffer {
	if (entries.length > 0xffff) throw new Error('Too many files for a zip archive (limit 65,535).');
	const parts: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = Buffer.from(entry.path, 'utf8');
		const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : Buffer.from(entry.data);
		const body = deflateRawSync(raw);
		const crc = crc32(raw);
		const { time, date } = dosDateTime(entry.modified);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(VERSION, 4);
		local.writeUInt16LE(UTF8_NAMES, 6);
		local.writeUInt16LE(DEFLATE, 8);
		local.writeUInt16LE(time, 10);
		local.writeUInt16LE(date, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(name.length, 26);

		const header = Buffer.alloc(46);
		header.writeUInt32LE(0x02014b50, 0);
		header.writeUInt16LE(VERSION, 4);
		header.writeUInt16LE(VERSION, 6);
		header.writeUInt16LE(UTF8_NAMES, 8);
		header.writeUInt16LE(DEFLATE, 10);
		header.writeUInt16LE(time, 12);
		header.writeUInt16LE(date, 14);
		header.writeUInt32LE(crc, 16);
		header.writeUInt32LE(body.length, 20);
		header.writeUInt32LE(raw.length, 24);
		header.writeUInt16LE(name.length, 28);
		header.writeUInt32LE(offset, 42);

		parts.push(local, name, body);
		central.push(header, name);
		offset += local.length + name.length + body.length;
		if (offset > 0xffffffff) throw new Error('Export is too large for a zip archive (limit 4 GB).');
	}

	const directory = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...parts, directory, end]);
}
