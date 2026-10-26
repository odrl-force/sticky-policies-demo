import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve(process.env.SERVE_DIST ? "dist" : ".");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".trig": "application/trig",
  ".md": "text/plain; charset=utf-8",
  ".ttf": "font/ttf",
};
const server = http.createServer(async (req, res) => {
  try {
    let name = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (name.endsWith("/")) name += "index.html";
    if (
      !process.env.SERVE_DIST &&
      (name.startsWith("/vendor/") || name.startsWith("/fonts/"))
    )
      name = "/public" + name;
    const file = resolve(root, "." + name);
    if (!file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!(await stat(file)).isFile()) throw new Error("Not found");
    const content = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(content);
  } catch {
    res.writeHead(404).end("Not found");
  }
});
server.listen(Number(process.env.PORT || 5173), "127.0.0.1", () =>
  console.log(`Local: http://localhost:${server.address().port}`),
);
