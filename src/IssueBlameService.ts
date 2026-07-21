import type { App } from 'obsidian';
import type { OntologyIndex } from './ontology/types.ts';
import type { getLastCommit } from './git.ts';

import { Platform } from 'obsidian';

import {
  getLastCommit as getLastCommitForFile,
  getRepoRoot
} from './git.ts';

export class IssueBlameService {
  // Resolved lazily; null means "checked and not in a git repo" or unsupported
  // on this platform.
  private repoRoot: string | null | undefined = undefined;

  public async attachBlameForBatch(app: App, index: OntologyIndex, batch: string[]): Promise<void> {
    if (!Platform.isDesktopApp) {
      this.repoRoot = null;
      return;
    }

    if (this.repoRoot === undefined) {
      const adapter = app.vault.adapter;
      const vaultPath = 'basePath' in adapter ? (adapter as { basePath: string }).basePath : null;
      this.repoRoot = vaultPath ? await getRepoRoot(vaultPath) : null;
    }
    if (!this.repoRoot) {
      return;
    }

    const root = this.repoRoot;
    const batchSet = new Set(batch);
    const unblamed = index.issues.filter((issue) => batchSet.has(issue.file) && !issue.blame);

    const filesSeen = new Set<string>();
    const blameByFile = new Map<string, Awaited<ReturnType<typeof getLastCommit>>>();
    await Promise.all(
      unblamed
        .filter((issue) => {
          if (filesSeen.has(issue.file)) {
            return false;
          }
          filesSeen.add(issue.file);
          return true;
        })
        .map(async (issue) => {
          const blame = await getLastCommitForFile(root, issue.file);
          blameByFile.set(issue.file, blame);
        })
    );

    for (const issue of unblamed) {
      const blame = blameByFile.get(issue.file);
      if (blame) {
        issue.blame = blame;
      }
    }
  }
}
