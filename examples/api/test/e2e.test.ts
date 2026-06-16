import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { createApp } from "../src/server.js";
import { ExampleClient, ApiError } from "../sdk/index.js";

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
