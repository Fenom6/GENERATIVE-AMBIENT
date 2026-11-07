import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createStaticServer } from '../tools/serve.mjs';

test('local preview serves the app and rejects traversal, internal files, writes, and missing assets', async () => {
  const server = await createStaticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = (url, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method }, (response) => {
      const chunks = []; response.on('data', (chunk) => { chunks.push(chunk); }); response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: response.statusCode, body: buffer.toString('utf8'), buffer, headers: response.headers });
      });
    }); req.on('error', reject); req.end();
  });
  try {
    const page = await request('/'); assert.equal(page.status, 200); assert.match(page.body, /自律型光背/);
    assert.match(page.headers['content-security-policy'], /connect-src 'none'/);
    assert.equal((await request('/js/music.js')).status, 200);
    assert.equal((await request('/vendor/halo/LICENSE')).status, 200);
    const picture = await request('/assets/halo-preview.png');
    assert.equal(picture.status, 200); assert.equal(picture.headers['content-type'], 'image/png');
    assert.deepEqual(picture.buffer, await readFile(new URL('../dist/assets/halo-preview.png', import.meta.url)));
    assert.deepEqual([...picture.buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(picture.buffer.readUInt32BE(16), 1200); assert.equal(picture.buffer.readUInt32BE(20), 630);
    assert.equal((await request('/%2e%2e/package.json')).status, 403);
    assert.equal((await request('/%2e%2e%5cpackage.json')).status, 403);
    assert.equal((await request('/.env')).status, 403);
    assert.equal((await request('/package.json')).status, 404);
    assert.equal((await request('/', 'POST')).status, 405);
    assert.equal((await request('/missing.js')).status, 404);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
