import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AllowList, readOnlyTools } from "../../src/permission/policy.ts";

describe("AllowList", () => {
  it("allows the read-only tools and asks for everything else", () => {
    const policy = new AllowList(readOnlyTools);
    for (const name of readOnlyTools) assert.equal(policy.decide(name, "").decision, "allow");
    assert.equal(policy.decide("write_file", "").decision, "ask");
    assert.equal(policy.decide("edit", "").decision, "ask");
    assert.equal(policy.decide("cmd", "").decision, "ask");
    assert.equal(policy.decide("git_status", "").decision, "ask");
  });
});
