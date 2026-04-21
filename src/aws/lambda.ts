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

/**
 * Default deployment package (Salesforce file-notifier-for-blob-store).
 * Override with env `UDLO_LAMBDA_ZIP_URL` or the `lambdaZipUrl` argument to `ensureLambda`.
 */
export const DEFAULT_LAMBDA_ZIP_URL =
  "https://raw.githubusercontent.com/forcedotcom/file-notifier-for-blob-store/main/cloud_function_zips/aws_lambda_function.zip";

const LAMBDA_ZIP_MAX_BYTES = 52 * 1024 * 1024;

export async function fetchLambdaZip(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    const snippet = await res.text().catch(() => "");
    throw new Error(
      `Failed to download Lambda deployment package (${res.status} ${res.statusText}): ${url}` +
        (snippet ? `\n${snippet.slice(0, 500)}` : ""),
    );
  }
  const len = res.headers.get("content-length");
  if (len && Number(len) > LAMBDA_ZIP_MAX_BYTES) {
    throw new Error(
      `Lambda zip Content-Length (${len} bytes) exceeds direct-upload limit; use a smaller package or S3-based deployment.`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > LAMBDA_ZIP_MAX_BYTES) {
    throw new Error(
      `Downloaded Lambda zip (${buf.byteLength} bytes) exceeds direct-upload limit for CreateFunction/UpdateFunctionCode.`,
    );
  }
  return buf;
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
  lambdaZipUrl: string = process.env.UDLO_LAMBDA_ZIP_URL ?? DEFAULT_LAMBDA_ZIP_URL,
): Promise<string> {
  const zipBuffer = await fetchLambdaZip(lambdaZipUrl);
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
