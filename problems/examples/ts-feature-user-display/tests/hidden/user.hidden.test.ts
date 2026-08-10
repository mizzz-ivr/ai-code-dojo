import assert from "node:assert/strict";
import test from "node:test";
import { formatDisplayName } from "../../starter/user.ts";

test("uses nickname when present", () => {
  assert.equal(formatDisplayName({ firstName: "Hanako", lastName: "Sato", nickName: "hana" }), "hana");
});
