const fs = require('fs');
const path = require('path');

// The Vercel deployment proxies /api to Render, so the browser uses same-origin
// requests and this remains blank. Set RENDER_API_URL only for direct API calls.
const apiUrl = (process.env.RENDER_API_URL || '').trim().replace(/\/+$/, '');
if (apiUrl && !/^https:\/\//i.test(apiUrl)) {
  throw new Error('RENDER_API_URL must be an HTTPS origin, such as https://learnpath-api.onrender.com.');
}

const target = path.join(__dirname, '..', 'public', 'runtime-config.js');
fs.writeFileSync(target, `// Generated at build time; do not put secrets in this file.\nwindow.LEARNPATH_API_URL = ${JSON.stringify(apiUrl)};\n`);
console.log(`Frontend API origin: ${apiUrl || 'same origin (local development)'}`);
