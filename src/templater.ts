import type { App, TFile } from 'obsidian';

interface TemplaterPlugin {
  templater: {
    create_running_config: (templateFile: TFile, targetFile: TFile, runMode: number) => unknown;
    read_and_parse_template: (config: unknown) => Promise<string>;
  };
}

function getTemplaterPlugin(app: App): TemplaterPlugin | null {
  const plugins = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins?.plugins;
  const tp = plugins?.['templater-obsidian'];
  if (tp && typeof tp === 'object' && 'templater' in tp) {
    return tp as TemplaterPlugin;
  }
  return null;
}

function extractBody(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith('---')) {
    return content;
  }
  const end = trimmed.indexOf('\n---', 3);
  if (end === -1) {
    return content;
  }
  return content.slice(end + 4);
}

function hasBody(content: string): boolean {
  return extractBody(content).trim().length > 0;
}

export async function applyTypeTemplate(app: App, templateName: string, entityFile: TFile): Promise<boolean> {
  const content = await app.vault.read(entityFile);
  if (hasBody(content)) {
    return false;
  }

  const templateFile = app.metadataCache.getFirstLinkpathDest(templateName, entityFile.path);
  if (!templateFile) {
    return false;
  }

  const tp = getTemplaterPlugin(app);
  if (tp) {
    try {
      // RunMode 0 = CreateNewFromTemplate
      const config = tp.templater.create_running_config(templateFile, entityFile, 0);
      const result = await tp.templater.read_and_parse_template(config);
      await app.vault.modify(entityFile, result);
      return true;
    } catch {
      // Fall through to raw copy
    }
  }

  // Fallback: copy template body directly (no Templater processing)
  const templateContent = await app.vault.read(templateFile);
  const body = extractBody(templateContent);
  if (!body.trim()) {
    return false;
  }
  const frontmatterEnd = content.indexOf('\n---\n', content.startsWith('---') ? 3 : 0);
  const frontmatter = frontmatterEnd >= 0 ? content.slice(0, frontmatterEnd + 5) : content;
  await app.vault.modify(entityFile, frontmatter + body);
  return true;
}
