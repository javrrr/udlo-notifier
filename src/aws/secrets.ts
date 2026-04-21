import { readFileSync } from "node:fs";
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  PutResourcePolicyCommand,
  PutSecretValueCommand,
  ResourceExistsException,
  ResourceNotFoundException,
  type SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

/** PEM as a single SecretString (matches `cat keypair.pem`); normalize line endings and strip UTF-8 BOM. */
function normalizePemForSecret(raw: string): string {
  return raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

async function describeSecretArn(smClient: SecretsManagerClient, secretId: string): Promise<string> {
  const d = await smClient.send(new DescribeSecretCommand({ SecretId: secretId }));
  if (!d.ARN) {
    throw new Error(`Secret ${secretId} has no ARN`);
  }
  return d.ARN;
}

async function ensureSecretString(
  smClient: SecretsManagerClient,
  name: string,
  secretString: string,
): Promise<string> {
  try {
    const created = await smClient.send(
      new CreateSecretCommand({
        Name: name,
        SecretString: secretString,
      }),
    );
    if (created.ARN) {
      return created.ARN;
    }
  } catch (e) {
    if (!(e instanceof ResourceExistsException)) {
      throw e;
    }
    await smClient.send(
      new PutSecretValueCommand({
        SecretId: name,
        SecretString: secretString,
      }),
    );
  }
  return describeSecretArn(smClient, name);
}

async function attachLambdaGetSecretPolicy(
  smClient: SecretsManagerClient,
  secretArn: string,
  lambdaRoleArn: string,
): Promise<void> {
  const policy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: lambdaRoleArn },
        Action: "secretsmanager:GetSecretValue",
        Resource: secretArn,
      },
    ],
  });
  await smClient.send(
    new PutResourcePolicyCommand({
      SecretId: secretArn,
      ResourcePolicy: policy,
      BlockPublicPolicy: true,
    }),
  );
}

export async function ensureSecrets(
  smClient: SecretsManagerClient,
  consumerKeySecretName: string,
  rsaKeySecretName: string,
  consumerKey: string,
  pemFilePath: string,
  lambdaRoleArn: string,
  _awsAccountId: string,
): Promise<{ consumerKeySecretArn: string; rsaKeySecretArn: string }> {
  const consumerKeyPlain = consumerKey.trim();
  if (!consumerKeyPlain) {
    throw new Error("Consumer key is empty; check Connected App metadata and setup state.");
  }
  const pem = normalizePemForSecret(readFileSync(pemFilePath, "utf-8"));

  const consumerKeySecretArn = await ensureSecretString(smClient, consumerKeySecretName, consumerKeyPlain);
  const rsaKeySecretArn = await ensureSecretString(smClient, rsaKeySecretName, pem);

  await attachLambdaGetSecretPolicy(smClient, consumerKeySecretArn, lambdaRoleArn);
  await attachLambdaGetSecretPolicy(smClient, rsaKeySecretArn, lambdaRoleArn);

  return { consumerKeySecretArn, rsaKeySecretArn };
}

export async function destroySecrets(smClient: SecretsManagerClient, names: string[]): Promise<void> {
  for (const name of names) {
    try {
      await smClient.send(
        new DeleteSecretCommand({
          SecretId: name,
          ForceDeleteWithoutRecovery: true,
        }),
      );
    } catch (e) {
      if (!(e instanceof ResourceNotFoundException)) {
        throw e;
      }
    }
  }
}
