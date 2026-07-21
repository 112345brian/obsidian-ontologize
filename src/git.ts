export interface GitBlame {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

type ExecFile = typeof import('node:child_process').execFile;

async function getExecFile(): Promise<ExecFile | null> {
  try {
    return (await import('node:child_process')).execFile;
  } catch {
    return null;
  }
}

/**
 * Returns the last git commit that touched `filePath` (relative to `repoRoot`),
 * or null if git is unavailable or the file has no commits.
 */
export async function getLastCommit(repoRoot: string, filePath: string): Promise<GitBlame | null> {
  const execFile = await getExecFile();
  if (!execFile) {
    return null;
  }

  return new Promise((resolve) => {
    execFile(
      'git',
      ['log', '-1', '--format=%H%x00%h%x00%an%x00%ad%x00%s', '--date=short', '--', filePath],
      { cwd: repoRoot },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve(null);
          return;
        }
        const parts = stdout.trim().split('\0');
        if (parts.length < 5) {
          resolve(null);
          return;
        }
        const [hash, shortHash, author, date, message] = parts as [string, string, string, string, string];
        resolve({ hash, shortHash, author, date, message });
      },
    );
  });
}

/**
 * Returns the git repo root containing `startDir`, or null if not in a git repo.
 */
export async function getRepoRoot(startDir: string): Promise<string | null> {
  const execFile = await getExecFile();
  if (!execFile) {
    return null;
  }

  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--show-toplevel'], { cwd: startDir }, (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
  });
}
