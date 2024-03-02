import { context } from 'esbuild';
import { parseArgs } from 'node:util';
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { default as _externalGlobalPlugin } from 'esbuild-plugin-external-global';

const { externalGlobalPlugin } = _externalGlobalPlugin;

function externalGlobals(pkg, global, mods) {
  const entries = mods.map(m => [`${pkg}/${m}.js`, global]);
  return Object.fromEntries(entries);
}

const options = parseArgs({
	config: {
		keep: { short: 'k', type: 'boolean', default: false },
		watch: { short: 'w', type: 'boolean', default: false },
	},
}).values;

const core_externals = externalGlobals('@browserfs/core', 'BrowserFS', [
	'ApiError', 'FileIndex', 'backends/AsyncStore', 'backends/SyncStore',
	'cred', 'file', 'filesystem', 'inode', 'mutex', 'stats', 'utils'
  ]);

const ctx = await context({
	entryPoints: ['src/index.ts'],
	target: 'es2020',
	globalName: 'BrowserFS_DOM',
	outfile: 'dist/browser.min.js',
	sourcemap: true,
	keepNames: true,
	bundle: true,
	minify: true,
	platform: 'browser',
	plugins: [
		externalGlobalPlugin(core_externals),
		{ name: 'watcher', setup(build) {
			build.onStart(() => {
				if(!options.keep) {
					rmSync('dist', { force: true, recursive: true });
				}

				try {
					execSync('tsc -p tsconfig.json');
				} catch (e) {
					console.error('status' in e ? e.toString() : e);
				}
			});
		} }
	],
});

if(options.watch) {
	console.log('Watching for changes...');
	await ctx.watch();
} else {
	await ctx.rebuild();
	await ctx.dispose();
}
