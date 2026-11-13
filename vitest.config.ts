import { defineConfig } from 'vitest/config';

/**
 * Two projects with different characteristics:
 *
 * - `unit` exercises pure logic against an injected fake system. It is fast
 *   and may run in parallel.
 * - `integration` creates real temporary directories and real Git
 *   repositories, and runs the compiled binary as a child process. Its files
 *   run one at a time so concurrent fixtures cannot interfere through the
 *   process-wide working directory or a shared Git configuration.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
