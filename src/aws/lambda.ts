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
} from "@aws-sdk/client-lambda";
import { crc32 } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HANDLER_SRC = fileURLToPath(new URL("../lambda/handler.mjs", import.meta.url));

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Minimal single-file ZIP (stored, no compression) — Lambda accepts stored entries.
export function buildLambdaZip(): Buffer {
  const name = Buffer.from("handler.mjs");
  const data = readFileSync(HANDLER_SRC);
  const crc = crc32(data);
  const size = data.length;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(size, 18);
  local.writeUInt32LE(size, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(size, 20);
  central.writeUInt32LE(size, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);

  const centralOffset = local.length + name.length + data.length;
  const centralSize = central.length + name.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([local, name, data, central, name, eocd]);
}

async function waitActive(lambda: LambdaClient, name: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const cfg = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: name }));
    if (cfg.LastUpdateStatus === "Failed") {
      throw new Error(`Lambda ${name} update failed: ${cfg.LastUpdateStatusReason ?? "unknown"}`);
    }
    if (cfg.State === "Active" && cfg.LastUpdateStatus !== "InProgress") return;
    await sleep(2000);
  }
  throw new Error(`Lambda ${name} did not become active in time`);
}

export async function ensureLambda(
  lambda: LambdaClient,
  name: string,
  roleArn: string,
  loginUrl: string,
  username: string,
  consumerKeySecretName: string,
  rsaKeySecretName: string,
): Promise<string> {
  const zip = buildLambdaZip();
  const env = {
    Variables: {
      SF_LOGIN_URL: loginUrl.replace(/\/+$/, ""),
      SF_USERNAME: username,
      CONSUMER_KEY: consumerKeySecretName,
      RSA_PRIVATE_KEY: rsaKeySecretName,
    },
  };

  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: name }));
    await waitActive(lambda, name);
    await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: name, ZipFile: zip }));
    await waitActive(lambda, name);
    for (let i = 0; i < 5; i++) {
      try {
        await lambda.send(
          new UpdateFunctionConfigurationCommand({
            FunctionName: name,
            Handler: "handler.handler",
            Timeout: 60,
            Environment: env,
          }),
        );
        break;
      } catch (e) {
        if (!(e instanceof ResourceConflictException)) throw e;
        await sleep(3000);
        await waitActive(lambda, name);
      }
    }
  } catch (e) {
    if (!(e instanceof ResourceNotFoundException)) throw e;
    await lambda.send(
      new CreateFunctionCommand({
        FunctionName: name,
        Runtime: "nodejs20.x",
        Handler: "handler.handler",
        Role: roleArn,
        Code: { ZipFile: zip },
        Timeout: 60,
        Environment: env,
      }),
    );
  }

  await waitActive(lambda, name);
  const cfg = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: name }));
  if (!cfg.FunctionArn) throw new Error(`Lambda ${name} missing FunctionArn`);
  return cfg.FunctionArn;
}

export async function destroyLambda(lambda: LambdaClient, name: string): Promise<void> {
  try {
    await lambda.send(new DeleteFunctionCommand({ FunctionName: name }));
  } catch (e) {
    if (!(e instanceof ResourceNotFoundException)) throw e;
  }
}
