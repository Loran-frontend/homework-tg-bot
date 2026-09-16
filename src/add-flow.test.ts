import assert from "node:assert/strict";
import test from "node:test";
import { parseAddCommand } from "./add-flow.js";

test("direct /add creates valid homework input", () => {
  const result = parseAddCommand("Решить задачи | 25.09.2026 23:59");
  assert.ok(result);
  assert.equal(result.type, "IRNITU");
  assert.equal(result.subject, "Вычислительная математика");
  assert.equal(result.subgroup, "ALL");
  assert.equal(result.description, "Решить задачи");
  assert.equal(result.deadline?.toISOString(), "2026-09-25T23:59:00.000Z");
});
