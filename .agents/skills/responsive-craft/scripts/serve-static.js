#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
};

const LIVE_RELOAD_SCRIPT = `
<script>
(function() {
  var source = new EventSource('/__reload');
  source.onmessage = function() { location.reload(); };
  source.onerror = function() { source.close(); };
})();
</script>
`;

const rootDirInput = path.resolve(process.argv[2] || '.');
let startPort = parseInt(process.argv[3], 10) || 8787;

if (!fs.existsSync(rootDirInput)) {
  console.error(`Error: Directory does not exist: ${rootDirInput}`);
  process.exit(1);
}

let realRootDir;
try {
  realRootDir = fs.realpathSync(rootDirInput);
} catch (err) {
  console.error(`Error resolving real path for ${rootDirInput}: ${err.message}`);
  process.exit(1);
}

// Track SSE clients for live reload
const reloadClients = [];

// Watch for file changes
let debounceTimer;
fs.watch(realRootDir, { recursive: true }, () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    reloadClients.forEach(res => {
      try { res.write('data: reload\n\n'); } catch {
        const idx = reloadClients.indexOf(res);
        if (idx !== -1) reloadClients.splice(idx, 1);
      }
    });
  }, 150);
});

function serve(port) {
  const server = http.createServer((req, res) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, 'http://127.0.0.1');
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('400 Bad Request: Malformed URL');
      return;
    }

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(parsedUrl.pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('400 Bad Request: Malformed percent-encoding');
      return;
    }

    // SSE endpoint for live reload (same-origin, no wildcard CORS)
    if (decodedPath === '/__reload') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('data: connected\n\n');
      reloadClients.push(res);
      req.on('close', () => {
        const idx = reloadClients.indexOf(res);
        if (idx !== -1) reloadClients.splice(idx, 1);
      });
      return;
    }

    // Serve internal responsive preview UI without copying to user's project directory
    if (decodedPath === '/_responsive-preview.html') {
      const previewHtmlPath = path.join(__dirname, 'preview.html');
      fs.readFile(previewHtmlPath, (err, data) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('500 Internal Server Error: Could not load preview UI');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
      return;
    }

    let filePath = path.resolve(realRootDir, decodedPath.replace(/^\/+/, ''));

    // Default to index.html for directory requests
    if (fs.existsSync(filePath)) {
      try {
        if (fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`404 Not Found: ${req.url}`);
        return;
      }
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`404 Not Found: ${req.url}`);
      return;
    }

    // Resolve realpath to prevent symlink traversal out of root directory
    let realFile;
    try {
      realFile = fs.realpathSync(filePath);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`404 Not Found: ${req.url}`);
      return;
    }

    const canonicalRoot = realRootDir.endsWith(path.sep) ? realRootDir : realRootDir + path.sep;
    if (realFile !== realRootDir && !realFile.startsWith(canonicalRoot)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden: Path traversal detected');
      return;
    }

    fs.readFile(realFile, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`404 Not Found: ${req.url}`);
        return;
      }

      const ext = path.extname(realFile).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      // Inject live reload script into HTML files
      if (ext === '.html') {
        let html = data.toString();
        if (html.includes('</body>')) {
          html = html.replace('</body>', `${LIVE_RELOAD_SCRIPT}</body>`);
        } else {
          html += LIVE_RELOAD_SCRIPT;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(html);
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      }
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      serve(port + 1);
    } else {
      console.error(`Server error: ${err.message}`);
      process.exit(1);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`SERVING_PORT:${port}`);
    console.log(`Serving ${realRootDir} at http://127.0.0.1:${port}`);
    console.log('Live reload enabled — file changes trigger browser refresh');
  });
}

serve(startPort);
