// Build a second copy of the app with Meta's headset emulator (IWER) bundled in,
// served at <site>/emulator/ so people without a Quest can try it in a desktop
// browser. The Quest browser is excluded by user agent and gets real WebXR.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'iwsdk.config.json';
const original = readFileSync(file, 'utf8');
const config = JSON.parse(original);
config.dev = config.dev ?? {};
config.dev.emulator = { ...(config.dev.emulator ?? {}), injectOnBuild: true, activation: 'always' };
writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
try {
  execSync('npx vite build --outDir dist/emulator --emptyOutDir', { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
} finally {
  writeFileSync(file, original);
}
