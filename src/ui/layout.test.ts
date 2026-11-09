import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { measureModal, measureScreen } from "./layout.ts";

describe("yoga screen slots", () => {
  it("gives the leftover rows to the scrollback", () => {
    const slots = measureScreen(80, 24, false);
    assert.equal(slots.status, 1);
    assert.equal(slots.input, 4);
    assert.equal(slots.debug, 0);
    assert.equal(slots.scroll, 19);
  });

  it("keeps a 12-row debug panel when the terminal is tall enough", () => {
    const slots = measureScreen(80, 30, true);
    assert.equal(slots.debug, 12);
    assert.equal(slots.scroll, 13);
  });

  it("reserves the @ picker between the status line and the input", () => {
    const slots = measureScreen(80, 24, false, 6);
    assert.equal(slots.mention, 6);
    assert.equal(slots.input, 4);
    assert.equal(slots.status, 1);
    assert.equal(slots.scroll, 13);
  });

  it("leaves a flexible body in the approval modal", () => {
    assert.equal(measureModal(80, 24).body, 20);
  });
});
