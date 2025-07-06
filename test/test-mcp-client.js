#!/usr/bin/env node

// A more realistic MCP client test script that handles responses properly

import { spawn } from 'child_process';
import { Buffer } from 'buffer';

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
const env = {
  ...process.env,
  MCP_SEARXNG_DEBUG: 'true',
  NODE_TLS_REJECT_UNAUTHORIZED: '0',
  SEARXNG_INSTANCES: 'https://searxng.lan'
};

console.log('Starting MCP server with environment:', env);
const mcpProcess = spawn('node', ['dist/src/index.js'], { env });

// Buffer to store partial messages
let stdoutBuffer = Buffer.alloc(0);
let stderrOutput = '';

// Parse MCP responses
mcpProcess.stdout.on('data', (data) => {
  stdoutBuffer = Buffer.concat([stdoutBuffer, data]);
  
  // Process complete messages
  while (stdoutBuffer.length >= 4) {
    const length = stdoutBuffer.readUInt32LE(0);
    
    if (stdoutBuffer.length < length + 4) {
      break; // Wait for more data
    }
    
    const messageBuffer = stdoutBuffer.slice(4, length + 4);
    stdoutBuffer = stdoutBuffer.slice(length + 4);
    
    try {
      const message = JSON.parse(messageBuffer.toString('utf8'));
      console.log('Received MCP response:', JSON.stringify(message, null, 2));
    } catch (error) {
      console.error('Failed to parse MCP response:', error);
      console.error('Raw message:', messageBuffer.toString('utf8'));
    }
  }
});

mcpProcess.stderr.on('data', (data) => {
  stderrOutput += data.toString();
  process.stderr.write(data);
});

mcpProcess.on('exit', () => {
  console.log('MCP server process exited');
  process.exit();
});

// Wait a bit for the server to start before sending requests
setTimeout(() => {
  console.log('\nSending valid request...');
  sendMCPRequest(mcpProcess, {
    jsonrpc: '2.0',
    id: 'valid-request',
    method: 'tools/call',
    params: {
      name: 'web_search',
      arguments: {
        query: 'test query'
      }
    }
  });
  
  // Wait a bit before sending the invalid request
  setTimeout(() => {
    console.log('\nSending request with missing required parameter...');
    sendMCPRequest(mcpProcess, {
      jsonrpc: '2.0',
      id: 'missing-query',
      method: 'tools/call',
      params: {
        name: 'web_search',
        arguments: {
          // Missing required 'query' field
          page: 1
        }
      }
    });
    
    // Wait a bit before sending another invalid request
    setTimeout(() => {
      console.log('\nSending request with invalid parameter type...');
      sendMCPRequest(mcpProcess, {
        jsonrpc: '2.0',
        id: 'invalid-param-type',
        method: 'tools/call',
        params: {
          name: 'web_search',
          arguments: {
            query: 'test query',
            page: '1' // Should be a number
          }
        }
      });
      
      // Wait a bit before sending non-existent tool request
      setTimeout(() => {
        console.log('\nSending request for non-existent tool...');
        sendMCPRequest(mcpProcess, {
          jsonrpc: '2.0',
          id: 'wrong-tool',
          method: 'tools/call',
          params: {
            name: 'non_existent_tool',
            arguments: {
              query: 'test'
            }
          }
        });
        
        // Clean up after all tests are done
        setTimeout(() => {
          console.log('\nTests completed, closing process...');
          mcpProcess.kill();
        }, 5000);
      }, 5000);
    }, 5000);
  }, 5000);
}, 2000);
