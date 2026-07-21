import { rmSync } from 'node:fs';

for (const file of ['main.js', 'styles.css'] as const) {
  rmSync(file, { force: true });
}
