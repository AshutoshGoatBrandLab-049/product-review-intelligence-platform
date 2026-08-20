module.exports = {
  testDir: './tests/e2e',
  testMatch: '**/*.{test,spec}.{js,ts}',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html'],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: {
        browserName: 'chromium',
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      },
    },
  ],
  timeout: 120000,
  expect: {
    timeout: 10000,
  },
};
