import { describe, expect, test } from "bun:test";

import { decode } from "@/lib/code-meanings";

describe("code decoder", () => {
  test("every code kind resolves to a meaning", () => {
    expect(decode("log", 51).meaning).toBe("Locked with key / thumbturn");
    expect(decode("log", 999).meaning).toContain("Not in");
    expect(decode("jobStatus", 3).meaning).toContain("PIN not found");
    expect(decode("jobState", 1).meaning).toBe("Pending");
    expect(decode("jobType", 4).meaning).toBe("Create custom PIN");
    expect(decode("wifi", 0).meaning).toBe("Connected");
    expect(decode("event", 10).meaning).toContain("Bridge connection");
    expect(decode("http", 402).meaning).toContain("trial");
    expect(decode("http", 406, { meaning: "PIN already taken" }).meaning).toBe("PIN already taken");
    expect(decode("outcome", "rate_limited").meaning).toContain("429");
    expect(decode("model", "IGB4").meaning).toBe("Deadbolt 2S Metal Grey");
    expect(decode("pinType", 4).meaning).toContain("Duration");
  });
});
