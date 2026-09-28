// Generates the fallback-login value for .env. Usage: `bun run hash-password`
// The password is read without echo and never printed or written anywhere; only the base64 bcrypt hash is printed.
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

import bcrypt from "bcryptjs";

function askHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

const password = await askHidden("New fallback password (min 12 chars): ");
if (password.length < 12) {
  console.error("Password must be at least 12 characters.");
  process.exit(1);
}
const confirm = await askHidden("Repeat password: ");
if (confirm !== password) {
  console.error("Passwords do not match.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
console.log("\nAdd this line to your local .env (never commit it):\n");
console.log(`AUTH_FALLBACK_PASSWORD_HASH_B64=${Buffer.from(hash, "utf8").toString("base64")}`);
