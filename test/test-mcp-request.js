#!/usr/bin/env node

// Simple script to test MCP requests with various arguments

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Utility to send messages to the MCP server
function sendMCPRequest(mcpProcess, request) {
  const message = JSON.stringify(request);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(message.length, 0);
  
  const payload = Buffer.concat([
    header,
    Buffer.from(message, 'utf8')
  ]);
  
  mcpProcess.stdin.write(payload);
}

// Start MCP server process
const mcpProcess = spawn('node', ['dist/src/index.js'], {
  env: {
    ...process.env,
    MCP_SEARXNG_DEBUG: 'true',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    SEARXNG_INSTANCES: 'https://searxng.lan'
  }
});

// Log process output
mcpProcess.stdout.on('data', (data) => {
  console.log('MCP stdout:', data.toString());
});

mcpProcess.stderr.on('data', (data) => {
  console.log('MCP stderr:', data.toString());
});

// Wait a bit for the server to start before sending requests
setTimeout(() => {
  console.log("Testing valid request...");
  sendMCPRequest(mcpProcess, {
    jsonrpc: "2.0",
    id: "valid-request",
    method: "tools/call",
    params: {
      name: "web_search",
      arguments: {
        query: "test query"
      }
    }
  });
  
  // Wait a bit before sending the invalid request
  setTimeout(() => {
    console.log("Testing request with missing required parameter...");
    sendMCPRequest(mcpProcess, {
      jsonrpc: "2.0",
      id: "missing-query",
      method: "tools/call",
      params: {
        name: "web_search",
        arguments: {
          // Missing required 'query' field
          page: 1
        }
      }
    });
    
    // Wait a bit before sending another invalid request
    setTimeout(() => {
      console.log("Testing request with invalid parameter type...");
      sendMCPRequest(mcpProcess, {
        jsonrpc: "2.0",
        id: "invalid-param-type",
        method: "tools/call",
        params: {
          name: "web_search",
          arguments: {
            query: "test query",
            page: "not a number" // Should be a number
          }
        }
      });
      
      // Clean up after all tests are done
      setTimeout(() => {
        console.log("Tests completed, closing process...");
        mcpProcess.kill();
        process.exit(0);
      }, 5000);
    }, 2000);
  }, 2000);
}, 2000);
