import type { FrontmatterValue } from './types.ts';

export interface TemplateContext {
  now: Date;
}

type InsertTemplate = (context: TemplateContext) => FrontmatterValue;

const INSERT_TEMPLATES = new Map<string, InsertTemplate>([
  ['date.now()', (context) => localDate(context.now)],
]);

export function isInsertTemplate(value: unknown): value is string {
  return typeof value === 'string' && INSERT_TEMPLATES.has(value);
}

function localDate(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolveInsertTemplate(value: FrontmatterValue, context: TemplateContext): FrontmatterValue {
  return typeof value === 'string' ? INSERT_TEMPLATES.get(value)?.(context) ?? value : value;
}
