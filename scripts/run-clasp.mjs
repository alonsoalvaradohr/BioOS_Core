import { execSync } from 'child_process';
import path from 'path';

const claspCmd = path.join(process.env.APPDATA, 'npm', 'clasp.cmd');
console.log('Using clasp binary:', claspCmd);

try {
  const output = execSync(`"${claspCmd}" ${process.argv.slice(2).join(' ')}`, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30000
  });
  console.log(output);
} catch (err) {
  console.error('CLASP ERROR:', err.message);
  if (err.stdout) console.log('STDOUT:', err.stdout);
  if (err.stderr) console.error('STDERR:', err.stderr);
}
