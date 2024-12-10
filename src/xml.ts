import type { Backend, File, StatsLike } from '@zenfs/core';
import { decodeRaw, encodeRaw, Errno, ErrnoError, FileSystem, PreloadFile, Stats, Sync } from '@zenfs/core';
import { S_IFDIR, S_IFREG } from '@zenfs/core/emulation/constants.js';

export interface XMLOptions {
	parent?: Node;
}

const statsLikeKeys = ['size', 'mode', 'atimeMs', 'mtimeMs', 'ctimeMs', 'birthtimeMs', 'uid', 'gid', 'ino', 'nlink'] as const;

function get_stats(node: Element): Stats {
	const stats: Partial<StatsLike<number>> = {};
	for (const key of statsLikeKeys) {
		const value = node.getAttribute(key);
		stats[key] = value != null ? parseInt(value, 16) : undefined;
	}
	return new Stats(stats);
}

function set_stats(node: Element, stats: Partial<StatsLike<number>>): void {
	for (const key of statsLikeKeys) {
		if (stats[key] != undefined) {
			node.setAttribute(key, stats[key].toString(16));
		}
	}
}

function get_paths(node: Element): string[] {
	let paths: string[];
	try {
		paths = JSON.parse(node.getAttribute('paths')!) as string[];
	} catch {
		paths = [];
	}
	return paths;
}

function add_path(node: Element, path: string): void {
	const paths = get_paths(node);
	paths.push(path);
	node.setAttribute('paths', JSON.stringify(paths));
}

function remove_path(node: Element, path: string): void {
	const paths = get_paths(node);

	const i = paths.indexOf(path);
	if (i == -1) return;
	paths.splice(i, 1);

	if (!paths.length) {
		node.remove();
	} else {
		node.setAttribute('paths', JSON.stringify(paths));
	}
}

export class XMLFS extends Sync(FileSystem) {
	protected document = new DOMParser().parseFromString('<fs></fs>', 'application/xml');

	public constructor(public readonly parent?: Node) {
		super();

		try {
			this.create('[[init]]', '/', { mode: 0o777 | S_IFDIR });
		} catch (e: any) {
			const error = e as ErrnoError;
			if (error.code != 'EEXIST') throw error;
		}

		if (parent) parent.appendChild(this.document.documentElement);
	}

	public renameSync(oldPath: string, newPath: string): void {
		const node = this.get('rename', oldPath);
		remove_path(node, oldPath);
		add_path(node, newPath);
	}

	public statSync(path: string): Stats {
		return get_stats(this.get(path, 'stat'));
	}

	public openFileSync(path: string, flag: string): File {
		const node = this.get('openFile', path);
		return new PreloadFile(this, path, flag, get_stats(node), encodeRaw(node.textContent!));
	}

	public createFileSync(path: string, flag: string, mode: number): File {
		const stats = new Stats({ mode: mode | S_IFREG });
		this.create('createFile', path, stats);
		return new PreloadFile(this, path, flag, stats);
	}

	public unlinkSync(path: string): void {
		const node = this.get('unlink', path);
		if (get_stats(node).isDirectory()) throw ErrnoError.With('EISDIR', path, 'unlink');
		remove_path(node, path);
	}

	public rmdirSync(path: string): void {
		const node = this.get('rmdir', path);
		if (node.textContent?.length) throw ErrnoError.With('ENOTEMPTY', path, 'rmdir');
		if (!get_stats(node).isDirectory()) throw ErrnoError.With('ENOTDIR', path, 'rmdir');
		remove_path(node, path);
	}

	public mkdirSync(path: string, mode: number): void {
		this.create('mkdir', path, { mode: mode | S_IFDIR });
	}

	public readdirSync(path: string): string[] {
		const node = this.get('readdir', path);
		if (!get_stats(node).isDirectory()) throw ErrnoError.With('ENOTDIR', path, 'rmdir');
		try {
			return JSON.parse(node.textContent!) as string[];
		} catch (e) {
			throw new ErrnoError(Errno.EIO, 'Invalid directory listing: ' + e, path, 'readdir');
		}
	}

	public linkSync(target: string, link: string): void {
		const node = this.get('link', target);
		add_path(node, link);
	}

	public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		const node = this.get('sync', path);
		node.textContent = decodeRaw(data);
		set_stats(node, stats);
	}

	public toString(): string {
		return new XMLSerializer().serializeToString(this.document);
	}

	protected get(syscall: string, path: string): Element {
		const { children } = this.document.documentElement;
		for (let i = 0; i < children.length; i++) {
			if (get_paths(children[i]).includes(path)) return children[i];
		}
		throw ErrnoError.With('ENOENT', path, syscall);
	}

	protected create(syscall: string, path: string, stats: Partial<StatsLike<number>> = {}): Element {
		if (this.existsSync(path)) throw ErrnoError.With('EEXIST', path, syscall);
		const node = this.document.createElement('file');
		node.setAttribute('paths', JSON.stringify([path]));
		set_stats(node, stats);
		this.document.append(node);
		return node;
	}
}

const _XML = {
	name: 'XML',
	options: {
		parent: { type: 'object', required: false },
	},
	isAvailable(): boolean {
		return true;
	},
	create(options: XMLOptions) {
		return new XMLFS(options.parent);
	},
} satisfies Backend<XMLFS, XMLOptions>;

type _XML = typeof _XML;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface XML extends _XML {}
/**
 * @experimental
 */
export const XML: XML = _XML;
