/* Explicit installation, never a download on the renderer/UI thread. */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
try {
  run('uv', ['python', 'install', '3.11']);
  const python = path.join(root, '.pulseflow-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(python)) run('uv', ['venv', '--python', '3.11', '.pulseflow-venv']);
  const cuda = spawnSync('nvidia-smi', [], { stdio: 'ignore', windowsHide: true }).status === 0;
  run('uv', ['pip', 'install', '--python', python, 'torch==2.5.1', 'torchvision==0.20.1', 'torchaudio==2.5.1',
    '--index-url', `https://download.pytorch.org/whl/${cuda ? 'cu124' : 'cpu'}`]);
  run('uv', ['pip', 'install', '--python', python, '--no-deps', '-r', 'src/pulseflow/requirements.lock']);
  run('uv', ['pip', 'check', '--python', python]);
  console.log('PulseFlow runtime installed. Open Settings → PulseFlow → Update library index.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
