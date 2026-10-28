import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

let requests = 0,
  items = 0,
  lastCall = 0;
const server = createServer(async (req, res) => {
  const json = (value) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  try {
    if (req.url === '/stats') return json({ requests, items, lastCall });
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
