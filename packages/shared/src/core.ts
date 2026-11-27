/**
 * Lightweight entry (`@siseep/shared/core`): enums, theme, dates and CASL rules, without the zod
 * schemas. The web imports it in the code that runs at start-up so zod is only loaded with the
 * screens that validate forms (stage 6, performance).
 */
export * from './enums';
export * from './theme';
export * from './dates';
export * from './abilities';
