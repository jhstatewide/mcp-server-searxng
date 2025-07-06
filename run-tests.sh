#!/bin/bash

# Use stable Node.js version
echo "Switching to stable Node.js version..."
source "$NVM_DIR/nvm.sh" && nvm use stable

# Set environment variables directly in case the setup file doesn't load
export SEARXNG_INSTANCES="https://searxng.lan"
export NODE_TLS_REJECT_UNAUTHORIZED="0"

# Run tests 
echo "Running tests..."
# Try yarn first, fall back to npm if yarn is not available
if command -v yarn &> /dev/null; then
    yarn run test
else
    npm run test
fi

# Check test exit status
TEST_EXIT_CODE=${PIPESTATUS[0]}
if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo -e "\n\033[32mAll tests passed successfully!\033[0m"
else
    echo -e "\n\033[31mTests failed with exit code $TEST_EXIT_CODE\033[0m"
    exit $TEST_EXIT_CODE
fi
