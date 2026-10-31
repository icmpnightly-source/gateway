// Stand-in destination: replies with the request it received, so you can see
// exactly what the gateway forwarded.
const http = require('node:http');

const PORT = 8080;

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const received = {
        method: req.method,
        path: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(received, null, 2));
    });
  })
  .listen(PORT, () => console.log(`echo listening on :${PORT}`));
