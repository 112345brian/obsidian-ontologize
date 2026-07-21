import type {
  App,
  Component,
  MarkdownPostProcessorContext
} from 'obsidian';
import type { OntologyIndex } from './ontology/types.ts';
import type { QueryIncludeMode } from './ontology/query.ts';

import { MarkdownRenderer } from 'obsidian';

import { runOntologyQueryDetailed } from './ontology/query.ts';

export async function renderOntologyQueryBlock(
  app: App,
  owner: Component,
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  index: OntologyIndex,
  defaultInclude: QueryIncludeMode
): Promise<void> {
  // An explicit `include:` in the block always wins; the setting only moves the default.
  const { entities: results, warnings } = runOntologyQueryDetailed(index, source, { defaultInclude });

  el.empty();
  el.addClass('ontology-query-results');

  for (const warning of warnings) {
    el.createEl('p', { cls: 'ontology-query-warning', text: `⚠ ${warning}` });
  }

  if (results.length === 0) {
    el.createEl('p', { cls: 'ontology-query-empty', text: 'No matching ontology notes.' });
    return;
  }

  const table = el.createEl('table');
  const header = table.createEl('thead').createEl('tr');
  header.createEl('th', { text: 'Note' });
  header.createEl('th', { text: 'Types' });
  header.createEl('th', { text: 'Lock' });

  const body = table.createEl('tbody');
  for (const entity of results) {
    const row = body.createEl('tr');
    const noteCell = row.createEl('td');
    await MarkdownRenderer.render(app, `[[${entity.name}]]`, noteCell, ctx.sourcePath, owner);
    row.createEl('td', { text: entity.instanceOf.join(', ') });
    row.createEl('td', { text: index.effectiveEntityLocks.get(entity.path)?.state ?? 'unlocked' });
  }

  el.createEl('p', {
    cls: 'ontology-query-count',
    text: `${results.length} ${results.length === 1 ? 'note' : 'notes'}.`
  });
}
