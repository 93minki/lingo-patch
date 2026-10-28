import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

let requests = 0,
  items = 0,
  lastCall = 0,
  delayMs = 0,
  completed = 0;
const batches = [];
const glossaryBatches = [];
const server = createServer(async (req, res) => {
  const json = (value) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  try {
    if (req.url === '/stats')
      return json({
        requests,
        items,
        lastCall,
        completed,
        batches,
        glossaryBatches,
      });
    if (req.url === '/control' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      delayMs = JSON.parse(Buffer.concat(chunks).toString()).delayMs ?? 0;
      return json({ ok: true });
    }
    if (req.url === '/v1/models')
      return json({ data: [{ id: 'lingo-patch-e2e-mock' }] });
    if (req.url === '/pending-a') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Queue fixture</title><style>p{margin:0;font:10px/1px system-ui} button{position:fixed;top:8px;left:50%;transform:translateX(-50%);width:300px;height:40px}</style></head><body><button onclick="this.dataset.clicked='yes'">Page action</button>${Array.from({ length: 170 }, (_, i) => `<p>Pending fixture paragraph number ${i} explains the stable function.</p>`).join('')}</body></html>`,
      );
    }
    if (req.url === '/p6') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(
        '<!doctype html><html lang="en"><head><title>P6</title><style>p{font:16px/24px sans-serif;margin:12px}</style></head><body><p id="with-props">These props describe behavior.</p><p id="other">Unique independent paragraph.</p><input value="private input text"></body></html>',
      );
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const input = JSON.parse(
        body.messages.find((message) => message.role === 'user').content,
      );
      requests++;
      items += input.items.length;
      lastCall = Date.now();
      batches.push(input.items.map((item) => item.text));
      glossaryBatches.push(input.glossary);
      await delay(delayMs);
      completed++;
      return json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: input.items.map((item) => ({
                  id: item.id,
                  text: `[KO] ${item.text}`,
                })),
              }),
            },
          },
        ],
      });
    }
    if (req.url === '/nextjs') {
      const html = await readFile(
        new URL('../fixtures/nextjs-docs.html', import.meta.url),
        'utf8',
      );
      const css = `<style>body{margin:0;font:16px/20px system-ui} header{position:sticky;top:0;min-height:64px;background:white;display:flex;align-items:center;z-index:10} header>div>div{display:flex;align-items:center;gap:8px} header>div>div>div{display:flex;align-items:center} header [class*=fixed]{display:none} header nav{display:flex;height:40px;overflow:hidden} header img{max-height:32px;width:auto} header a{display:inline-flex;align-items:center;gap:8px} svg{display:none} aside{width:300px} aside li>div{display:flex;align-items:center} aside a{display:flex;flex:1;line-height:20px} img{max-width:120px}</style>`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html.replace('</head>', `${css}</head>`));
    }
    const fixture = { '/a': 'react-learn.html', '/b': 'mdn-array-map.html' }[
      req.url
    ];
    if (fixture) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(
        await readFile(new URL(`../fixtures/${fixture}`, import.meta.url)),
      );
    }
    res.writeHead(404);
    res.end();
  } catch {
    res.writeHead(500);
    res.end('Invalid mock request');
  }
});
server.listen(4174, '127.0.0.1');
