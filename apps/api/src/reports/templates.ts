import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const cache = new Map<string, string>();

/** Escapes text for HTML (student names and activity titles come from users). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Loads `templates/<name>.html` and replaces `{{key}}`. Values are escaped, except keys listed
 * in `raw` (already-built HTML such as table rows).
 */
export function renderTemplate(
  name: string,
  values: Record<string, string>,
  raw: string[] = [],
): string {
  let template = cache.get(name);
  if (!template) {
    template = readFileSync(join(__dirname, 'templates', `${name}.html`), 'utf8');
    cache.set(name, template);
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key] ?? '';
    return raw.includes(key) ? value : escapeHtml(value);
  });
}
