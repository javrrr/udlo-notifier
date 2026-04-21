import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readState, updateState, writeState, type PipelineState } from "../src/state.js";

describe("state", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readState returns empty object when file missing", () => {
    dir = mkdtempSync(join(tmpdir(), "udlo-state-"));
    expect(readState(dir)).toEqual({});
  });

  it("writeState and readState round-trip", () => {
    dir = mkdtempSync(join(tmpdir(), "udlo-state-"));
    const state: PipelineState = { udloName: "Test", awsRegion: "us-west-2" };
    writeState(dir, state);
    expect(readState(dir)).toEqual(state);
  });

  it("updateState merges partial", () => {
    dir = mkdtempSync(join(tmpdir(), "udlo-state-"));
    writeState(dir, { udloName: "A" });
    const merged = updateState(dir, { udmoName: "B" });
    expect(merged).toEqual({ udloName: "A", udmoName: "B" });
    expect(readState(dir)).toEqual({ udloName: "A", udmoName: "B" });
  });
});
