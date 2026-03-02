import { defineConfig } from 'eslint/config';
import shared from '@zenfs/core/eslint';

export default defineConfig(...shared, {
	files: ['src/**/*.ts', 'tests/**/*.ts'],
	name: 'Enable typed checking',
	languageOptions: {
		parserOptions: {
			projectService: true,
			tsconfigRootDir: import.meta.dirname,
		},
	},
});
