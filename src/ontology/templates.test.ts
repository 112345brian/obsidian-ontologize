import { describe, expect, it } from 'vitest';

import { isInsertTemplate, resolveInsertTemplate } from './templates.ts';

describe('insert templates', () => {
  it('resolves date.now() to the current local date', () => {
    const now = new Date(2026, 5, 11, 14, 30, 0);

    expect(isInsertTemplate('date.now()')).toBe(true);
    expect(resolveInsertTemplate('date.now()', { now })).toBe('2026-06-11');
  });

  it('leaves literal inserted values unchanged', () => {
    expect(isInsertTemplate('[[Person]]')).toBe(false);
    expect(resolveInsertTemplate('[[Person]]', { now: new Date() })).toBe('[[Person]]');
  });
});
