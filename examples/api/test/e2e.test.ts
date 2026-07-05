import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { createApp } from "../src/server.js";
import { ExampleClient, ApiError, type Transport } from "../sdk/index.js";

let server: Server;
let client: ExampleClient;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  client = new ExampleClient({ baseUrl: `http://localhost:${port}` });
});

afterAll(() => {
  server?.close();
});

describe("generated SDK against the example app", () => {
  it("lists, creates, and gets users with typed, validated responses", async () => {
    expect(await client.listUsers()).toEqual([]);

    const created = await client.createUser({
      body: { name: "Ada", email: "ada@example.com" },
    });
    expect(created.name).toBe("Ada");
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

    const fetched = await client.getUser({ params: { id: created.id } });
    expect(fetched).toEqual(created);

    expect(await client.listUsers()).toHaveLength(1);
  });

  it("reaches a nested router at its fully-qualified path", async () => {
    // /accounts/admins/:id is served by a sub-router mounted under /accounts.
    const id = "11111111-1111-4111-8111-111111111111";
    const admin = await client.getAccountAdmin({ params: { id } });
    expect(admin).toMatchObject({ id, name: "Admin" });
    expect(await client.listAccounts()).toEqual([]);
  });

  it("throws ApiError(404) for a missing user", async () => {
    await expect(
      client.getUser({ params: { id: "does-not-exist" } }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws ApiError(400) when createRoute request validation fails", async () => {
    await expect(
      client.createUser({ body: { name: "", email: "not-an-email" } }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("SDK response validation", () => {
  it("throws when the server returns a drifted shape", async () => {
    const rogue = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ not: "an array" }));
    });
    await new Promise<void>((resolve) => rogue.listen(0, resolve));
    const addr = rogue.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const rogueClient = new ExampleClient({
      baseUrl: `http://localhost:${port}`,
    });

    await expect(rogueClient.listUsers()).rejects.toThrow();
    // A drift error is a ZodError, not an ApiError (the response was 200).
    await expect(rogueClient.listUsers()).rejects.not.toBeInstanceOf(ApiError);

    rogue.close();
  });
});

describe("per-method Transport", () => {
  const CANNED_USER = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Canned",
    email: "canned@example.com",
  };

  it("routes GET through a custom Transport while POST uses the default", async () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const calls: string[] = [];
    const getTransport: Transport = async (req) => {
      calls.push(req.method);
      // Answer without touching the server; still schema-validated by the SDK.
      return { status: 200, data: [CANNED_USER] };
    };

    const c = new ExampleClient({
      baseUrl: `http://localhost:${port}`,
      transports: { GET: getTransport },
    });

    // GET went through the custom Transport (canned data, not the server's []).
    expect(await c.listUsers()).toEqual([CANNED_USER]);
    expect(calls).toEqual(["GET"]);

    // POST still uses the default fetch Transport and hits the real server.
    const created = await c.createUser({
      body: { name: "Grace", email: "grace@example.com" },
    });
    expect(created.name).toBe("Grace");
    expect(calls).toEqual(["GET"]); // custom Transport never saw the POST
  });

  it("turns a non-2xx from a custom Transport into ApiError", async () => {
    const getTransport: Transport = async () => ({
      status: 503,
      data: { message: "down" },
    });
    const c = new ExampleClient({
      baseUrl: "http://unused.invalid",
      transports: { GET: getTransport },
    });

    await expect(c.listUsers()).rejects.toMatchObject({
      status: 503,
      body: { message: "down" },
    });
  });

  it("uses the client-wide default Transport for every method", async () => {
    const calls: string[] = [];
    const transport: Transport = async (req) => {
      calls.push(req.method);
      return { status: 200, data: [CANNED_USER] };
    };
    const c = new ExampleClient({ transport });

    expect(await c.listUsers()).toEqual([CANNED_USER]);
    expect(calls).toEqual(["GET"]);
  });

  it("forwards RequestOptions.signal to the Transport", async () => {
    const ctrl = new AbortController();
    let seen: AbortSignal | undefined;
    const transport: Transport = async (req) => {
      seen = req.signal;
      return { status: 200, data: [] };
    };
    const c = new ExampleClient({ transport });

    await c.listUsers({}, { signal: ctrl.signal });
    expect(seen).toBe(ctrl.signal);
  });

  it("hands the Transport an unserialized body and a JSON content-type", async () => {
    let seenBody: unknown;
    let seenContentType: string | undefined;
    const postTransport: Transport = async (req) => {
      seenBody = req.body;
      seenContentType = req.headers["content-type"];
      return { status: 201, data: { ...CANNED_USER, name: "Ivy" } };
    };
    const c = new ExampleClient({ transports: { POST: postTransport } });

    await c.createUser({ body: { name: "Ivy", email: "ivy@example.com" } });
    // Body reaches the Transport as an object, not a JSON string — the
    // Transport owns serialization; the SDK only sets the header.
    expect(seenBody).toEqual({ name: "Ivy", email: "ivy@example.com" });
    expect(seenContentType).toBe("application/json");
  });
});
