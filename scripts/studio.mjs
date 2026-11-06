// Start the song studio with the guitar tool's own Python venv. A Node launcher,
// because npm runs scripts through cmd.exe on Windows, which can't run a
// forward-slash path like tools/guitar-separation/.venv/Scripts/python.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tool = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'tools/guitar-separation');
const python = join(tool, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
if (!existsSync(python)) {
  console.error(`No Python venv at ${python}. Set it up first: see tools/guitar-separation/README.md`);
  process.exit(1);
}

const child = spawn(python, [join(tool, 'studio.py'), ...process.argv.slice(2)], { stdio: 'inherit' });
// Ctrl+C reaches the child directly (same console); just wait for it to exit.
process.on('SIGINT', () => {});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
