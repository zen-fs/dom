import tseslint from 'typescript-eslint';
import shared from '@zenfs/core/eslint';

export default tseslint.config(...shared, {
	files: ['src/**/*.ts', 'tests/**/*.ts'],
	name: 'Enable typed checking',
	languageOptions: {
		parserOptions: {
			projectService: true,
			tsconfigRootDir: import.meta.dirname,
		},
	},
});
