import assert from "node:assert/strict";
import test from "node:test";
import { parseEditCommand, parseId } from "./bot.js";

test("parseId accepts only positive integer ids", () => {
  assert.equal(parseId("1"), 1);
  assert.equal(parseId(" 42 "), 42);
  assert.equal(parseId("0"), null);
  assert.equal(parseId("-1"), null);
  assert.equal(parseId("1.5"), null);
  assert.equal(parseId("abc"), null);
  assert.equal(parseId(""), null);
});

test("parseEditCommand requires id and non-empty text", () => {
  assert.deepEqual(parseEditCommand("1 Математика — решить №1–20"), {
    id: 1,
    text: "Математика — решить №1–20",
  });
  assert.equal(parseEditCommand(""), null);
  assert.equal(parseEditCommand("1"), null);
  assert.equal(parseEditCommand("abc текст"), null);
  assert.equal(parseEditCommand("1    "), null);
});
