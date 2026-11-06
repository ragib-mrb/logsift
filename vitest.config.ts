import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Plain-text log times have no zone; keep test results the same on every machine.
    env: { TZ: 'UTC', NO_COLOR: '1' },
  },
});
