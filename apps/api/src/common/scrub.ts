/** Pino paths that may carry personal data; their values are replaced with "[oculto]". */
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body',
  'res.body',
  '*.email',
  '*.password',
  '*.firstName',
  '*.lastName',
  '*.lastName1',
  '*.lastName2',
  '*.fullName',
  '*.name',
  '*.text',
  '*.comment',
  '*.observations',
  '*.code',
];

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
/** Mongo duplicate-key messages repeat the value: `dup key: { email: "ana@x.mx" }`. */
const DUP_KEY = /dup key: \{[^}]*\}/g;
const QUOTED = /"[^"]{2,}"/g;

/** Removes emails, duplicate-key values and quoted strings from an error message or stack. */
export function scrubText(value: string): string {
  return value
    .replace(DUP_KEY, 'dup key: { [oculto] }')
    .replace(EMAIL, '[correo]')
    .replace(QUOTED, '"[oculto]"');
}
