import { describe, expect, test } from "bun:test";

import bcrypt from "bcryptjs";

import type { AuthConfig } from "@/server/config";
import { atLeast } from "@/server/domain/models";
import { changeOwnPassword, checkPassword, createUser, ensureBootstrap, listAudit, resetPassword, updateUser, verifyPassword } from "@/server/users";

import { openTestDb } from "../helpers/db";

// Accounts and roles (plan F2) on PGlite.

const hash = bcrypt.hashSync("break-glass-password", 4);
const config = { fallback: { username: "root", passwordHash: hash, role: "super_admin" } } as unknown as AuthConfig;

describe("roles", () => {
  test("super-admin passes every operator check; unknown ranks lowest", () => {
    expect(atLeast("super_admin", "operator")).toBe(true);
    expect(atLeast("operator", "operator")).toBe(true);
    expect(atLeast("operator", "super_admin")).toBe(false);
    expect(atLeast("viewer", "operator")).toBe(false);
    expect(atLeast(undefined, "viewer")).toBe(false);
  });
});

describe("accounts", () => {
  test("bootstrap copies the .env account once, as super-admin", async () => {
    const db = await openTestDb();
    expect(await ensureBootstrap(config, db)).toBe("created");
    expect(await ensureBootstrap(config, db)).toBe("exists");
    const root = await verifyPassword("ROOT", "break-glass-password", db); // usernames are case-insensitive
    expect(root?.role).toBe("super_admin");
    expect((await listAudit(10, db))[0]).toMatchObject({ actor: "bootstrap", action: "user.create", target: "root" });
  });

  test("new account: temporary password, must change it, then signs in with the new one", async () => {
    const db = await openTestDb();
    const made = await createUser({ username: "ops.one", displayName: "Ops One", role: "operator" }, "root", db);
    if (!made.ok) throw new Error(made.reason);
    expect(made.user.mustChangePassword).toBe(true);
    expect(made.temporaryPassword).toHaveLength(16);
    expect(await verifyPassword("ops.one", made.temporaryPassword!, db)).toBeDefined();

    expect(await changeOwnPassword(made.user.id, made.temporaryPassword!, "short", db)).toMatchObject({ ok: false });
    expect(await changeOwnPassword(made.user.id, made.temporaryPassword!, "ops.one-is-long-enough", db)).toMatchObject({ ok: false }); // contains username
    const changed = await changeOwnPassword(made.user.id, made.temporaryPassword!, "correct horse battery", db);
    expect(changed).toMatchObject({ ok: true, user: { mustChangePassword: false } });
    expect(await verifyPassword("ops.one", made.temporaryPassword!, db)).toBeUndefined();
    expect(await verifyPassword("ops.one", "correct horse battery", db)).toBeDefined();
  });

  test("duplicate username and bad input are refused", async () => {
    const db = await openTestDb();
    await createUser({ username: "ops", displayName: "", role: "operator" }, "root", db);
    expect(await createUser({ username: "OPS", displayName: "", role: "operator" }, "root", db)).toMatchObject({ ok: false });
    expect(await createUser({ username: "a", displayName: "", role: "operator" }, "root", db)).toMatchObject({ ok: false });
    expect(await createUser({ username: "okname", displayName: "", role: "owner" as never }, "root", db)).toMatchObject({ ok: false, reason: "Unknown role" });
  });

  test("a disabled account cannot sign in; a reset forces a new password", async () => {
    const db = await openTestDb();
    const made = await createUser({ username: "temp", displayName: "", role: "viewer" }, "root", db);
    if (!made.ok) throw new Error(made.reason);
    await updateUser(made.user.id, { status: "disabled" }, { name: "root" }, db);
    expect(await verifyPassword("temp", made.temporaryPassword!, db)).toBeUndefined();
    await updateUser(made.user.id, { status: "active" }, { name: "root" }, db);
    const reset = await resetPassword(made.user.id, "root", db);
    expect(reset).toMatchObject({ ok: true, user: { mustChangePassword: true } });
    expect(await verifyPassword("temp", made.temporaryPassword!, db)).toBeUndefined();
  });

  test("nobody changes their own role or status, and one active super-admin always remains", async () => {
    const db = await openTestDb();
    await ensureBootstrap(config, db);
    const root = (await verifyPassword("root", "break-glass-password", db))!;
    expect(await updateUser(root.id, { role: "operator" }, { id: root.id, name: "root" }, db)).toMatchObject({ ok: false });
    expect(await updateUser(root.id, { status: "disabled" }, { id: 999, name: "other" }, db)).toMatchObject({
      ok: false,
      reason: "At least one active super-admin must remain",
    });
    const second = await createUser({ username: "boss2", displayName: "", role: "super_admin" }, "root", db);
    if (!second.ok) throw new Error(second.reason);
    expect(await updateUser(root.id, { role: "operator" }, { id: second.user.id, name: "boss2" }, db)).toMatchObject({ ok: true });
  });

  test("password rules", () => {
    expect(checkPassword("abc", "x")).toContain("12");
    expect(checkPassword("myname-password-123", "myname")).toContain("username");
    expect(checkPassword("a long passphrase here", "ops")).toBeUndefined();
  });
});
