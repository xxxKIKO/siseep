import base from '@siseep/eslint-config/base';

export default [
  ...base,
  {
    files: ['test/**/*.ts'],
    languageOptions: { globals: { jest: 'readonly' } },
  },
];
