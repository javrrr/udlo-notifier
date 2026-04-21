import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

const STATE_FILE = ".udlo-state.json";

export function readState(dir: string): PipelineState {
  const path = join(dir, STATE_FILE);
  if (!existsSync(path)) {
    return {};
  }
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as PipelineState;
}

export function writeState(dir: string, state: PipelineState): void {
  writeFileSync(join(dir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

export function updateState(dir: string, partial: Partial<PipelineState>): PipelineState {
  const next: PipelineState = { ...readState(dir), ...partial };
  writeState(dir, next);
  return next;
}

export function clearState(dir: string): void {
  writeState(dir, {});
}
