import type { Backend, CreationOptions, File, FileSystemMetadata, InodeLike, StatsLike } from '@zenfs/core';
import { _inode_fields, constants, decodeRaw, encodeRaw, Errno, ErrnoError, FileSystem, LazyFile, Stats, Sync } from '@zenfs/core';
import { basename, dirname } from '@zenfs/core/vfs/path.js';

export interface XMLOptions {
	/**
	 * The root `fs` element
	 */
	root?: Element;
}

function get_stats(node: Element): Stats {
	const stats: Partial<InodeLike> = {};
	for (const key of _inode_fields) {
		const value = node.getAttribute(key);
		if (value !== null && value !== undefined) stats[key] = parseInt(value, 16);
	}
	return new Stats(stats);
}

function set_stats(node: Element, stats: Readonly<Partial<InodeLike>>): void {
	for (const key of Object.keys(stats) as (keyof InodeLike)[]) {
		if (!(key in _inode_fields) || stats[key] === undefined) continue;
		node.setAttribute(key, stats[key].toString(16));
	}
}

function get_paths(node: Element, contents: boolean = false): string[] {
	let paths: string[];
	try {
		const raw = contents ? node.textContent : node.getAttribute('paths');
		paths = JSON.parse(raw || '[]') as string[];
	} catch {
		paths = [];
	}
	return paths;
}

export class XMLFS extends Sync(FileSystem) {
	public constructor(
		/**
		 * @inheritdoc XMLOptions.root
		 */
		public readonly root: Element = new DOMParser().parseFromString('<fs></fs>', 'application/xml').documentElement
	) {
		super();

		try {
			this.mkdirSync('/', 0o777, { uid: 0, gid: 0 });
		} catch (e: any) {
			const error = e as ErrnoError;
			if (error.code != 'EEXIST') throw error;
		}
	}

	public metadata(): FileSystemMetadata {
		return { ...super.metadata(), features: ['setid'] };
	}

	public renameSync(oldPath: string, newPath: string): void {
		const node = this.get('rename', oldPath);
		this.remove('rename', node, oldPath);
		this.add('rename', node, newPath);
	}

	public statSync(path: string): Stats {
		return get_stats(this.get('stat', path));
	}

	public openFileSync(path: string, flag: string): File {
		const node = this.get('openFile', path);
		return new LazyFile(this, path, flag, get_stats(node));
	}

	public createFileSync(path: string, flag: string, mode: number, { uid, gid }: CreationOptions): File {
		const parent = this.statSync(dirname(path));
		const stats = new Stats({
			mode: mode | constants.S_IFREG,
			uid: parent.mode & constants.S_ISUID ? parent.uid : uid,
			gid: parent.mode & constants.S_ISGID ? parent.gid : gid,
		});
		this.create('createFile', path, stats);
		return new LazyFile(this, path, flag, stats);
	}

	public unlinkSync(path: string): void {
		const node = this.get('unlink', path);
		if (get_stats(node).isDirectory()) throw ErrnoError.With('EISDIR', path, 'unlink');
		this.remove('unlink', node, path);
	}

	public rmdirSync(path: string): void {
		const node = this.get('rmdir', path);
		if (node.textContent?.length) throw ErrnoError.With('ENOTEMPTY', path, 'rmdir');
		if (!get_stats(node).isDirectory()) throw ErrnoError.With('ENOTDIR', path, 'rmdir');
		this.remove('rmdir', node, path);
	}

	public mkdirSync(path: string, mode: number, { uid, gid }: CreationOptions): void {
		const parent = this.statSync(dirname(path));
		const node = this.create('mkdir', path, {
			mode: mode | constants.S_IFDIR,
			uid: parent.mode & constants.S_ISUID ? parent.uid : uid,
			gid: parent.mode & constants.S_ISGID ? parent.gid : gid,
		});
		node.textContent = '[]';
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
		this.add('link', node, link);
	}

	public syncSync(path: string, data?: Uint8Array, stats: Readonly<Partial<InodeLike>> = {}): void {
		const node = this.get('sync', path);
		if (data) node.textContent = decodeRaw(data);
		set_stats(node, stats);
	}

	public readSync(path: string, buffer: Uint8Array, offset: number, end: number): void {
		const node = this.get('read', path);
		const raw = encodeRaw(node.textContent!.slice(offset, end));
		buffer.set(raw);
	}

	public writeSync(path: string, buffer: Uint8Array, offset: number): void {
		const node = this.get('write', path);
		const data = decodeRaw(buffer);
		const after = node.textContent!.slice(offset + data.length);
		node.textContent = node.textContent!.slice(0, offset) + data + after;
	}

	public toString(): string {
		return new XMLSerializer().serializeToString(this.root);
	}

	protected get(syscall: string, path: string): Element {
		const nodes = this.root.children;
		if (!nodes) throw ErrnoError.With('EIO', path, syscall);
		for (let i = 0; i < nodes.length; i++) {
			if (get_paths(nodes[i]).includes(path)) return nodes[i];
		}
		throw ErrnoError.With('ENOENT', path, syscall);
	}

	protected create(syscall: string, path: string, stats: Partial<InodeLike> & Pick<StatsLike, 'mode'>): Element {
		if (this.existsSync(path)) throw ErrnoError.With('EEXIST', path, syscall);
		const node = document.createElement('file');
		this.add(syscall, node, path);
		set_stats(
			node,
			new Stats({
				...stats,
				uid: stats.mode,
			})
		);
		this.root.append(node);
		return node;
	}

	protected add(syscall: string, node: Element, path: string, contents: boolean = false): void {
		const paths = get_paths(node, contents);
		paths.push(path);
		if (contents) {
			node.textContent = JSON.stringify(paths);
			return;
		}
		node.setAttribute('paths', JSON.stringify(paths));
		node.setAttribute('nlink', paths.length.toString(16));
		if (path != '/') {
			const parent = this.get(syscall, dirname(path));
			this.add(syscall, parent, basename(path), true);
		}
	}

	protected remove(syscall: string, node: Element, path: string, contents: boolean = false): void {
		const paths = get_paths(node, contents);

		const i = paths.indexOf(path);
		if (i == -1) return;
		paths.splice(i, 1);

		if (contents) {
			node.textContent = JSON.stringify(paths);
			return;
		}

		if (!paths.length) {
			node.remove();
		} else {
			node.setAttribute('paths', JSON.stringify(paths));
			node.setAttribute('nlink', paths.length.toString(16));
		}

		if (path != '/') {
			const parent = this.get(syscall, dirname(path));
			this.remove(syscall, parent, basename(path), true);
		}
	}
}

const _XML = {
	name: 'XML',
	options: {
		root: { type: 'object', required: false },
	},
	isAvailable(): boolean {
		return true;
	},
	create(options: XMLOptions) {
		return new XMLFS(options.root);
	},
} satisfies Backend<XMLFS, XMLOptions>;

type _XML = typeof _XML;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface XML extends _XML {}
/**
 * @experimental
 */
export const XML: XML = _XML;
