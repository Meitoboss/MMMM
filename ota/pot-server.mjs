#!/usr/bin/env node

/**
 * PO Token server using yt-dlp
 *
 * Provides an HTTP server that generates YouTube PO tokens on demand.
 * Used by Music space to handle YouTube's BotGuard challenges.
 *
 * Endpoints:
 *   POST /get_pot       { "content_binding": "..." } → { "poToken": "...", "expiresAt": "..." }
 *   GET  /ping          health check
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration from environment
const API_KEY = process.env.POT_API_KEY || '';
const PORT = Number(process.env.POT_PORT || 8787);
const HOST = process.env.POT_HOST || '0.0.0.0';

// Token cache to avoid repeated generations
const tokenCache = new Map();
const CACHE_TTL_MS = 12 * 3600 * 1000; // 12 hours

console.log('PO Token Server starting...');
console.log(`API Key required: ${API_KEY ? 'yes' : 'NO (security risk!)'}`);
console.log(`Port: ${PORT}, Host: ${HOST}`);

/**
 * Extract PO token and expiry from yt-dlp output
 * yt-dlp with --yt-dlp-info outputs JSON with po_token and visitor_data
 */
async function generatePoToken(contentBinding) {
  // Check cache first
  const cached = tokenCache.get(contentBinding);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[cache hit] ${contentBinding}`);
    return cached;
  }

  console.log(`[token] generating for ${contentBinding}`);

  try {
    // Use yt-dlp to generate a PO token for the given content binding
    // The content_binding is either a video ID or visitor data
    const { stdout, stderr } = await execAsync(
      `yt-dlp --dump-json --yt-dlp-info '${contentBinding}' 2>/dev/null || echo '{}'`,
      { timeout: 10000, maxBuffer: 10 * 1024 * 1024 }
    );

    let data;
    try {
      data = JSON.parse(stdout);
    } catch {
      // Fallback: yt-dlp may output the PO token in a different format
      // Try extracting from the response
      console.log('[token] parsing yt-dlp response...');
      data = {};
    }

    if (!data.po_token) {
      throw new Error('yt-dlp did not return a po_token');
    }

    // Calculate expiry: PO tokens are typically valid for 12 hours
    const expiresAt = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
    const result = {
      poToken: data.po_token,
      expiresAt,
    };

    // Cache the token
    tokenCache.set(contentBinding, {
      ...result,
      expiresAt: Date.parse(expiresAt),
    });

    console.log(`[token] success for ${contentBinding}`);
    return result;
  } catch (error) {
    console.error(`[token] failed for ${contentBinding}: ${error.message}`);
    throw new Error(`Failed to generate PO token: ${error.message}`);
  }
}

/**
 * Verify API key from X-Api-Key header
 */
function verifyApiKey(req) {
  if (!API_KEY) return true; // No key required if not configured
  const key = req.headers['x-api-key'] || '';
  return key === API_KEY;
}

/**
 * Parse JSON body from request
 */
async function parseJsonBody(req, maxSize = 1024 * 100) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > maxSize) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  });
  res.end(body);
}

/**
 * Main request handler
 */
async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // Health check
    if (pathname === '/ping' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true });
    }

    // PO token generation
    if (pathname === '/get_pot' && req.method === 'POST') {
      if (!verifyApiKey(req)) {
        console.log('[auth] 401 unauthorized');
        return sendJson(res, 401, { error: 'Unauthorized' });
      }

      const body = await parseJsonBody(req);
      const contentBinding = body.content_binding;

      if (!contentBinding || typeof contentBinding !== 'string') {
        return sendJson(res, 400, { error: 'content_binding is required' });
      }

      const token = await generatePoToken(contentBinding);
      return sendJson(res, 200, token);
    }

    // Not found
    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(`[error] ${error.message}`);
    sendJson(res, 500, { error: error.message });
  }
}

/**
 * Start the server
 */
const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.log(`✓ PO Token server listening on http://${HOST}:${PORT}`);
  console.log('Ready to handle /get_pot and /ping requests');
});

server.on('error', (err) => {
  console.error(`Server error: ${err.message}`);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
