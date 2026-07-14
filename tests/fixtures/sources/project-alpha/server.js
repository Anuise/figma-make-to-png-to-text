import { createServer } from "node:http";

const port = process.env.PORT || 3000;

createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><html><body><h1>project-alpha</h1></body></html>");
}).listen(port);
