import { defineConfig } from 'vitest/config';

// Upstream specs use Vitest; scripts/build.test.mjs uses Node's test runner.
export default defineConfig({ test: { include: ['spec/**/*.spec.js'] } });
