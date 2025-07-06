// Direct test for isWebSearchArgs function
import { isWebSearchArgs } from '../src/index.js';

const testCases = [
  // Valid case
  {
    input: { query: "test query" },
    description: "Valid query"
  },
  // Invalid cases
  {
    input: {},
    description: "Missing query"
  },
  {
    input: { query: 123 },
    description: "Query is not a string"
  },
  {
    input: { query: "test", page: "1" },
    description: "Page is not a number"
  },
  {
    input: { query: "test", time_range: "invalid" },
    description: "Invalid time_range"
  },
  {
    input: { query: "test", categories: "general" },
    description: "Categories is not an array"
  },
  {
    input: { query: "test", categories: ["invalid"] },
    description: "Invalid category"
  },
  {
    input: { query: "test", safesearch: 3 },
    description: "Invalid safesearch value"
  }
];

console.log("Testing isWebSearchArgs function:");
testCases.forEach(test => {
  const result = isWebSearchArgs(test.input);
  console.log(`- ${test.description}:`);
  console.log(`  - Input: ${JSON.stringify(test.input)}`);
  console.log(`  - Result: ${JSON.stringify(result)}`);
});
