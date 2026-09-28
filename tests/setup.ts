import { mock } from "bun:test";

// `server-only` throws outside the React server environment. Tests exercise server modules directly.
mock.module("server-only", () => ({}));
