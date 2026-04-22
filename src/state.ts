import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface PipelineState {
  consumerKey?: string;
  s3ConnectionId?: string;
  s3ConnectionName?: string;
  udloName?: string;
  awsAccountId?: string;
  awsRegion?: string;
  awsProfile?: string;
  suffix?: string;
  lambdaRoleName?: string;
  lambdaRoleArn?: string;
  lambdaFunctionName?: string;
  lambdaFunctionArn?: string;
  consumerKeySecretName?: string;
  rsaKeySecretName?: string;
  s3Bucket?: string;
  s3Directory?: string;
}

const DIR = ".udlo-notifier";

export const workspaceDir = (root: string): string => join(root, DIR);
export const keysDir = (root: string): string => join(workspaceDir(root), "keys");
export const stateFile = (root: string): string => join(workspaceDir(root), "state.json");

export function createRetrieveTempDir(root: string): string {
  mkdirSync(workspaceDir(root), { recursive: true });
  return mkdtempSync(join(workspaceDir(root), "retrieve-"));
}

export function readState(root: string): PipelineState {
  const p = stateFile(root);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf-8")) as PipelineState) : {};
}

export function updateState(root: string, patch: Partial<PipelineState>): PipelineState {
  mkdirSync(workspaceDir(root), { recursive: true });
  const next = { ...readState(root), ...patch };
  writeFileSync(stateFile(root), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function removeWorkspace(root: string): void {
  const d = workspaceDir(root);
  if (existsSync(d)) rmSync(d, { recursive: true, force: true });
}
