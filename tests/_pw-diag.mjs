import http from 'node:http';
import { chromium } from 'playwright';
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h1 id="ok">ok</h1>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const url2 = `http://localhost:${server.address().port}/`;
console.log('env proxy:', process.env.HTTP_PROXY || process.env.http_proxy || '(none)', process.env.HTTPS_PROXY || '(none)', 'NO_PROXY=', process.env.NO_PROXY || '(none)');
const variants = [
  ['default', {}],
  ['no-proxy-server', { args: ['--no-proxy-server'] }],
  ['proxy direct', { proxy: { server: 'direct://' } }],
  ['channel chromium', { channel: 'chromium' }],
  ['channel chromium + no-proxy', { channel: 'chromium', args: ['--no-proxy-server'] }],
];
for (const [name, opts] of variants) {
  for (const u of [url, url2]) {
    let b; try { b = await chromium.launch(opts); const p = await b.newPage(); await p.goto(u, { timeout: 8000 }); console.log('✔', name, u, await p.textContent('#ok')); } catch (e) { console.log('✖', name, u, e.message.split('\n')[0]); } finally { if (b) await b.close(); }
  }
}
server.close();
