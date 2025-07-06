// Configure environment variables for tests
process.env.SEARXNG_INSTANCES = 'https://searxng.lan';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Disable SSL verification for tests
process.env.MCP_SEARXNG_DEBUG = 'false';
process.env.NODE_ENV = 'test'; // Ensure we're in test environment

// Add a global timeout that will force-exit if tests are hanging
let forceExitTimeout;

// Set up a global timeout that will force-exit after 10 seconds
beforeAll(() => {
  forceExitTimeout = setTimeout(() => {
    console.log('Force exiting after timeout - check for hanging promises or connections');
    process.exit(1);
  }, 10000);
});

// Force exit after tests complete
afterAll(done => {
  // Clear the force-exit timeout since we're exiting cleanly
  clearTimeout(forceExitTimeout);
  
  // Console methods will be automatically restored after tests
  
  // Close any remaining connections or resources
  // This should be called before done()
  
  // Give time for any pending operations to complete
  setTimeout(() => {
    done();
    // Force exit process after a small delay
    setTimeout(() => process.exit(0), 100);
  }, 500);
});
