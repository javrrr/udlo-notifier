import {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  ResourceConflictException,
  ResourceNotFoundException,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  type LambdaClient,
  type UpdateFunctionConfigurationRequest,
} from "@aws-sdk/client-lambda";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { sleep } from "../helpers.js";

const LAMBDA_ZIP_MAX_BYTES = 52 * 1024 * 1024;

/** Load a deployment package from disk (absolute path or relative to `process.cwd()`). */
export function loadLambdaZipFromPath(pathStr: string): Buffer {
  const trimmed = pathStr.trim();
  const resolved = isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
  if (!existsSync(resolved)) {
    throw new Error(`Lambda zip not found: ${resolved}`);
  }
  const st = statSync(resolved);
  if (!st.isFile()) {
    throw new Error(`Lambda zip path is not a file: ${resolved}`);
  }
  if (st.size > LAMBDA_ZIP_MAX_BYTES) {
    throw new Error(`Lambda zip (${st.size} bytes) exceeds direct-upload limit (${LAMBDA_ZIP_MAX_BYTES}).`);
  }
  return readFileSync(resolved);
}

/**
 * Lambda deployment package from env `UDLO_LAMBDA_ZIP_PATH` (required for `sf udlo setup`).
 * Download the official ZIP from Salesforce’s file-notifier-for-blob-store repo or run `npm run lambda:zip`.
 */
export function loadLambdaZipFromEnv(): Buffer {
  const fromPath = process.env.UDLO_LAMBDA_ZIP_PATH?.trim();
  if (!fromPath) {
    throw new Error(
      "UDLO_LAMBDA_ZIP_PATH must be set to a local .zip file path before deploying Lambda. " +
        "Download aws_lambda_function.zip from https://github.com/forcedotcom/file-notifier-for-blob-store " +
        "or run: npm run lambda:zip",
    );
  }
  return loadLambdaZipFromPath(fromPath);
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

/** UpdateFunctionConfiguration fails if code/config updates are still in progress; retry after waiting. */
async function sendUpdateFunctionConfigurationWithRetry(
  lambdaClient: LambdaClient,
  input: UpdateFunctionConfigurationRequest,
): Promise<void> {
  const name = input.FunctionName;
  if (!name) {
    throw new Error("UpdateFunctionConfiguration requires FunctionName");
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await lambdaClient.send(new UpdateFunctionConfigurationCommand(input));
      return;
    } catch (e) {
      if (e instanceof ResourceConflictException) {
        await sleep(3000);
        await waitForLambdaActive(lambdaClient, name);
        continue;
      }
      throw e;
    }
  }
  throw new Error(`Lambda ${name}: UpdateFunctionConfiguration still conflicted after retries`);
}

/**
 * Stock file-notifier handler uses `SF_LOGIN_URL` only to build `/services/oauth2/token`.
 * That URL must match JWT `aud` — both are the OAuth host (`login` or `test`), not My Domain.
 * The token response supplies `instance_url` for org-specific calls afterward.
 */
function envConfig(
  sfOauthBaseUrl: string,
  sfUsername: string,
  consumerKeySecretName: string,
  rsaKeySecretName: string,
) {
  const base = sfOauthBaseUrl.replace(/\/+$/, "");
  return {
    Variables: {
      SF_LOGIN_URL: base,
      SF_AUDIENCE_URL: base,
      SF_USERNAME: sfUsername,
      RSA_PRIVATE_KEY: rsaKeySecretName,
      CONSUMER_KEY: consumerKeySecretName,
    },
  };
}

export async function ensureLambda(
  lambdaClient: LambdaClient,
  functionName: string,
  roleArn: string,
  /**
   * `https://login.salesforce.com` or `https://test.salesforce.com` (no trailing slash).
   * Written to `SF_LOGIN_URL` and `SF_AUDIENCE_URL` so JWT `aud` and the token POST stay aligned.
   */
  sfOauthBaseUrl: string,
  sfUsername: string,
  consumerKeySecretName: string,
  rsaKeySecretName: string,
): Promise<string> {
  const zipBuffer = loadLambdaZipFromEnv();
  const environment = envConfig(sfOauthBaseUrl, sfUsername, consumerKeySecretName, rsaKeySecretName);

  try {
    await lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
    // Do not overlap Lambda updates: wait for any in-flight change, then code, then config.
    await waitForLambdaActive(lambdaClient, functionName);
    await lambdaClient.send(
      new UpdateFunctionCodeCommand({
        FunctionName: functionName,
        ZipFile: zipBuffer,
      }),
    );
    await waitForLambdaActive(lambdaClient, functionName);
    await sendUpdateFunctionConfigurationWithRetry(lambdaClient, {
      FunctionName: functionName,
      Handler: "unstructured_data.s3_events_handler",
      Timeout: 60,
      Environment: environment,
    });
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
