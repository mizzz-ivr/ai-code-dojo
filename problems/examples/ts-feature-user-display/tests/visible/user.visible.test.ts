import assert from "node:assert/strict";
import test from "node:test";
import { formatDisplayName } from "../../starter/user.ts";

test("returns full name", () => {
  assert.equal(formatDisplayName({ firstName: "Taro", lastName: "Yamada" }), "Taro Yamada");
});
