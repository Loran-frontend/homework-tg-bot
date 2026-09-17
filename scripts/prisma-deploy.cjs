const { spawnSync } = require("node:child_process");

const maxAttempts = 4;
const retryDelayMs = 15_000;
const yarnCommand = process.platform === "win32" ? "yarn.cmd" : "yarn";

function runMigration() {
  const result = spawnSync(yarnCommand, ["prisma", "migrate", "deploy"], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return { result, output };
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const { result, output } = runMigration();

  if (result.status === 0) {
    process.exit(0);
  }

  const isAdvisoryLockTimeout =
    output.includes("P1002") &&
    output.toLowerCase().includes("advisory lock");

  if (!isAdvisoryLockTimeout || attempt === maxAttempts) {
    process.exit(result.status ?? 1);
  }

  console.warn(
    `Prisma migration is waiting for a PostgreSQL advisory lock. ` +
      `Retrying in ${retryDelayMs / 1000}s (${attempt + 1}/${maxAttempts})...`,
  );

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs);
}
