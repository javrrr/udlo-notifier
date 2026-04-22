import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface PipelineState {
  // Salesforce
  consumerKey?: string;

  // Data Cloud
  s3ConnectionId?: string;
  udloName?: string;
  udmoName?: string;

  // AWS
  awsAccountId?: string;
  awsRegion?: string;
  /** Named profile from ~/.aws/credentials (optional); saved for teardown/status. */
  awsProfile?: string;
  lambdaRoleName?: string;
  lambdaRoleArn?: string;
  lambdaFunctionName?: string;
  lambdaFunctionArn?: string;
  consumerKeySecretName?: string;
  consumerKeySecretArn?: string;
  rsaKeySecretName?: string;
  rsaKeySecretArn?: string;
  s3Bucket?: string;
  s3Directory?: string;
}

/** Single directory under the DX project root for state, keys, and retrieve scratch dirs. */
export const UDLO_NOTIFIER_DIR = ".udlo-notifier";

export function udloNotifierDir(projectRoot: string): string {
  return join(projectRoot, UDLO_NOTIFIER_DIR);
}

export function keysDir(projectRoot: string): string {
  return join(udloNotifierDir(projectRoot), "keys");
}

export function stateFilePath(projectRoot: string): string {
  return join(udloNotifierDir(projectRoot), "state.json");
}

function legacyStateFilePath(projectRoot: string): string {
  return join(projectRoot, ".udlo-state.json");
}

function ensureUdloDir(projectRoot: string): void {
  mkdirSync(udloNotifierDir(projectRoot), { recursive: true });
}

/**
 * Temp directory for `sf project retrieve` (must stay inside the Salesforce project).
 * Caller must `rmSync` the path when done.
 */
export function createRetrieveTempDir(projectRoot: string): string {
  ensureUdloDir(projectRoot);
  return mkdtempSync(join(udloNotifierDir(projectRoot), "retrieve-"));
}

function readStateFromFile(path: string): PipelineState | null {
  if (!existsSync(path)) {
    return null;
  }
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as PipelineState;
}

export function readState(projectRoot: string): PipelineState {
  const fromNew = readStateFromFile(stateFilePath(projectRoot));
  if (fromNew !== null) {
    return fromNew;
  }
  const legacy = readStateFromFile(legacyStateFilePath(projectRoot));
  return legacy ?? {};
}

export function writeState(projectRoot: string, state: PipelineState): void {
  ensureUdloDir(projectRoot);
  writeFileSync(stateFilePath(projectRoot), `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  const leg = legacyStateFilePath(projectRoot);
  if (existsSync(leg)) {
    rmSync(leg, { force: true });
  }
}

export function updateState(projectRoot: string, partial: Partial<PipelineState>): PipelineState {
  const next: PipelineState = { ...readState(projectRoot), ...partial };
  writeState(projectRoot, next);
  return next;
}

export function clearState(projectRoot: string): void {
  writeState(projectRoot, {});
}

/** Removes the whole workspace dir (state, keys, retrieve leftovers) and legacy root files. */
export function removeUdloWorkspace(projectRoot: string): void {
  const udlo = udloNotifierDir(projectRoot);
  if (existsSync(udlo)) {
    rmSync(udlo, { recursive: true, force: true });
  }
  const leg = legacyStateFilePath(projectRoot);
  if (existsSync(leg)) {
    rmSync(leg, { force: true });
  }
  const oldKeys = join(projectRoot, ".udlo-keys");
  if (existsSync(oldKeys)) {
    rmSync(oldKeys, { recursive: true, force: true });
  }
}
