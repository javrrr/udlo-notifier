import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readState, removeWorkspace, stateFile, updateState, workspaceDir } from "../src/state.js";

describe("state", () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("readState returns empty when no file", () => {
    dir = mkdtempSync(join(tmpdir(), "udlo-"));
    expect(readState(dir)).toEqual({});
  });

  it("updateState merges partials and persists", () => {
    dir = mkdtempSync(join(tmpdir(), "udlo-"));
    updateState(dir, { udloName: "A", awsProfile: "p" });
    const next = updateState(dir, { udloName: "B" });
    expect(next).toEqual({ udloName: "B", awsProfile: "p" });
    expect(existsSync(stateFile(dir))).toBe(true);
  });

  it("removeWorkspace deletes the workspace dir", () => {
    dir = mkdtempSync(join(tmpdir(), "udlo-"));
    updateState(dir, { udloName: "X" });
    removeWorkspace(dir);
    expect(existsSync(workspaceDir(dir))).toBe(false);
  });
});
