import type { ServerResponse } from "node:http";

/** Server-sent events to every open studio tab. */
export class EventHub {
  private clients = new Set<ServerResponse>();

  attach(res: ServerResponse) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");
    this.clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    res.on("close", () => {
      clearInterval(ping);
      this.clients.delete(res);
    });
  }

  send(type: string, data: unknown = {}) {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) c.write(payload);
  }

  get size() {
    return this.clients.size;
  }

  close() {
    for (const c of this.clients) c.end();
    this.clients.clear();
  }
}
