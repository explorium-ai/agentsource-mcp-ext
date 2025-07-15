#!/usr/bin/env node

// CRITICAL: This MUST appear in logs if our code is running
console.error('🚀 EXPLORIUM SERVER STARTING - YOU SHOULD SEE THIS MESSAGE 🚀');
console.error('🔑 API_KEY:', process.env.API_KEY ? 'PRESENT' : 'MISSING');
console.error('🌐 MCP_URL:', process.env.MCP_URL || 'NOT SET');

// Test if we can run basic commands
console.error('📋 Testing basic functionality...');

const { spawn } = require('child_process');

// Simple test: run npx --version first
const testCmd = spawn('npx', ['--version'], {
  stdio: ['ignore', 'pipe', 'pipe']
});

testCmd.stdout.on('data', (data) => {
  console.error('✅ npx version:', data.toString().trim());
});

testCmd.stderr.on('data', (data) => {
  console.error('❌ npx error:', data.toString().trim());
});

testCmd.on('exit', (code) => {
  console.error('🏁 npx test exit code:', code);
  
  if (code === 0) {
    console.error('✅ npx works, now testing mcp-remote...');
    runMcpRemote();
  } else {
    console.error('❌ npx failed');
    process.exit(1);
  }
});

function runMcpRemote() {
  const API_KEY = process.env.API_KEY;
  const MCP_URL = process.env.MCP_URL || 'https://mcp-auth.explorium.ai/mcp';
  
  if (!API_KEY) {
    console.error('❌ NO API_KEY - exiting');
    process.exit(1);
  }

  console.error('🚀 Starting mcp-remote with URL:', MCP_URL);
  
  const args = ['mcp-remote', MCP_URL, '--header', `api_key: ${API_KEY}`];
  console.error('📋 Command: npx', args.join(' '));
  
  const mcpProcess = spawn('npx', args, {
    stdio: 'inherit'
  });
  
  mcpProcess.on('error', (error) => {
    console.error('❌ mcp-remote spawn error:', error);
    process.exit(1);
  });
  
  mcpProcess.on('exit', (code, signal) => {
    console.error(`🏁 mcp-remote exited with code ${code}, signal ${signal}`);
    process.exit(code || 0);
  });
}