import { defineConfig } from 'tsup';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  clean: true,
  sourcemap: true,
  target: 'node18',
  async onSuccess() {
    try {
      const rootLicense = path.resolve(process.cwd(), '../../LICENSE');
      const localLicense = path.resolve(process.cwd(), 'LICENSE');
      if (fs.existsSync(rootLicense)) {
        fs.copyFileSync(rootLicense, localLicense);
        console.log('Copied LICENSE to packages/cli');
      } else {
        console.warn('Root LICENSE not found at:', rootLicense);
      }
    } catch (err) {
      console.error('Failed to copy LICENSE:', err);
    }
  },
});
