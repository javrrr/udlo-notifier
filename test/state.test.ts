import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearState,
  keysDir,
  readState,
  removeUdloWorkspace,
  stateFilePath,
  udloNotifierDir,
  updateState,
  writeState,
  type PipelineState,
} from "../src/state.js";

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

  it("readState reads legacy .udlo-state.json at project root", () => {
    dir = mkdtempSync(join(tmpdir(), "udlo-state-"));
    const legacy = join(dir, ".udlo-state.json");
    writeFileSync(legacy, JSON.stringify({ udloName: "Legacy" }), "utf-8");
    expect(readState(dir)).toEqual({ udloName: "Legacy" });
  });

  it("writeState and readState round-trip", () => {
    dir = mkdtempSync(join(tmpdir(), "udlo-state-"));
    const state: PipelineState = { udloName: "Test", awsRegion: "us-west-2" };
    writeState(dir, state);
    expect(existsSync(stateFilePath(dir))).toBe(true);
    expect(readState(dir)).toEqual(state);
  });

  it("writeState removes legacy .udlo-state.json when present", () => {
    dir = mkdtempSync(join(tmpdir(), "udlo-state-"));
    const legacy = join(dir, ".udlo-state.json");
    writeFileSync(legacy, JSON.stringify({ udloName: "Old" }), "utf-8");
    writeState(dir, { udloName: "New" });
    expect(existsSync(legacy)).toBe(false);
    expect(readState(dir)).toEqual({ udloName: "New" });
  });

  it("updateState merges partial", () => {
    dir = mkdtempSync(join(tmpdir(), "udlo-state-"));
    writeState(dir, { udloName: "A" });
    const merged = updateState(dir, { udmoName: "B" });
    expect(merged).toEqual({ udloName: "A", udmoName: "B" });
    expect(readState(dir)).toEqual({ udloName: "A", udmoName: "B" });
  });

  it("updateState preserves awsProfile when partial omits it", () => {
    dir = mkdtempSync(join(tmpdir(), "udlo-state-"));
    writeState(dir, { awsProfile: "prod", awsRegion: "us-east-1" });
    const merged = updateState(dir, { udloName: "X" });
    expect(merged).toEqual({ awsProfile: "prod", awsRegion: "us-east-1", udloName: "X" });
  });

  it("clearState resets file to empty object", () => {
    dir = mkdtempSync(join(tmpdir(), "udlo-state-"));
    writeState(dir, { udloName: "X" });
    clearState(dir);
    expect(readState(dir)).toEqual({});
    expect(existsSync(stateFilePath(dir))).toBe(true);
  });

  it("removeUdloWorkspace deletes .udlo-notifier and legacy paths", () => {
    dir = mkdtempSync(join(tmpdir(), "udlo-state-"));
    writeState(dir, { udloName: "Z" });
    mkdirSync(keysDir(dir), { recursive: true });
    writeFileSync(join(keysDir(dir), "keypair.pem"), "x", "utf-8");
    writeFileSync(join(dir, ".udlo-state.json"), "{}", "utf-8");
    mkdirSync(join(dir, ".udlo-keys"), { recursive: true });
    writeFileSync(join(dir, ".udlo-keys", "keypair.pem"), "y", "utf-8");
    removeUdloWorkspace(dir);
    expect(existsSync(udloNotifierDir(dir))).toBe(false);
    expect(existsSync(join(dir, ".udlo-state.json"))).toBe(false);
    expect(existsSync(join(dir, ".udlo-keys"))).toBe(false);
  });
});
