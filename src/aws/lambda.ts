import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  ResourceNotFoundException,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  type LambdaClient,
} from "@aws-sdk/client-lambda";
import { sleep } from "../helpers.js";

function zipLambdaBundle(pluginRoot: string): Buffer {
  const workDir = mkdtempSync(join(tmpdir(), "udlo-lambda-zip-"));
  const zipPath = join(workDir, "function.zip");
  const lambdaDir = join(pluginRoot, "aws_lambda_function");
  try {
    execFileSync("zip", ["-q", "-r", zipPath, ".", "-x", "*.git*", "-x", "*__pycache__/*"], {
      cwd: lambdaDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return readFileSync(zipPath);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function waitForLambdaActive(lambdaClient: LambdaClient, functionName: string): Promise<void> {
  for (let i = 0; i < 90; i++) {
    const cfg = await lambdaClient.send(new GetFunctionConfigurationCommand({ FunctionName: functionName }));
    if (cfg.State === "Active" && cfg.LastUpdateStatus !== "InProgress") {
      if (cfg.LastUpdateStatus === "Failed") {
        throw new Error(
          `Lambda ${functionName} update failed: ${cfg.LastUpdateStatusReason ?? "unknown reason"}`,
        );
      }
      return;
    }
    await sleep(2000);
  }
  throw new Error(`Lambda ${functionName} did not become active in time`);
}

function envConfig(
  sfLoginUrl: string,
  sfUsername: string,
  consumerKeySecretName: string,
  rsaKeySecretName: string,
) {
  return {
    Variables: {
      SF_LOGIN_URL: sfLoginUrl,
      SF_USERNAME: sfUsername,
      SF_AUDIENCE_URL: sfLoginUrl,
      RSA_PRIVATE_KEY: rsaKeySecretName,
      CONSUMER_KEY: consumerKeySecretName,
    },
  };
}

export async function ensureLambda(
  lambdaClient: LambdaClient,
  functionName: string,
  roleArn: string,
  sfLoginUrl: string,
  sfUsername: string,
  consumerKeySecretName: string,
  rsaKeySecretName: string,
  pluginRoot: string,
): Promise<string> {
  const zipBuffer = zipLambdaBundle(pluginRoot);
  const environment = envConfig(sfLoginUrl, sfUsername, consumerKeySecretName, rsaKeySecretName);

  try {
    await lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
    await lambdaClient.send(
      new UpdateFunctionCodeCommand({
        FunctionName: functionName,
        ZipFile: zipBuffer,
      }),
    );
    await lambdaClient.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        Handler: "unstructured_data.s3_events_handler",
        Timeout: 60,
        Environment: environment,
      }),
    );
  } catch (e) {
    if (!(e instanceof ResourceNotFoundException)) {
      throw e;
    }
    await lambdaClient.send(
      new CreateFunctionCommand({
        FunctionName: functionName,
        Runtime: "python3.11",
        Handler: "unstructured_data.s3_events_handler",
        Role: roleArn,
        Code: { ZipFile: zipBuffer },
        Timeout: 60,
        Environment: environment,
      }),
    );
  }

  await waitForLambdaActive(lambdaClient, functionName);
  const final = await lambdaClient.send(new GetFunctionConfigurationCommand({ FunctionName: functionName }));
  if (!final.FunctionArn) {
    throw new Error(`Lambda ${functionName} has no FunctionArn after deploy`);
  }
  return final.FunctionArn;
}

export async function destroyLambda(lambdaClient: LambdaClient, functionName: string): Promise<void> {
  try {
    await lambdaClient.send(new DeleteFunctionCommand({ FunctionName: functionName }));
  } catch (e) {
    if (!(e instanceof ResourceNotFoundException)) {
      throw e;
    }
  }
}
