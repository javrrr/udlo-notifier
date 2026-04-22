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

async function putSecret(sm: SecretsManagerClient, name: string, value: string): Promise<string> {
  try {
    const r = await sm.send(new CreateSecretCommand({ Name: name, SecretString: value }));
    if (r.ARN) return r.ARN;
  } catch (e) {
    if (!(e instanceof ResourceExistsException)) throw e;
    await sm.send(new PutSecretValueCommand({ SecretId: name, SecretString: value }));
  }
  const d = await sm.send(new DescribeSecretCommand({ SecretId: name }));
  if (!d.ARN) throw new Error(`Secret ${name} has no ARN`);
  return d.ARN;
}

async function grantLambdaGet(sm: SecretsManagerClient, arn: string, roleArn: string): Promise<void> {
  await sm.send(
    new PutResourcePolicyCommand({
      SecretId: arn,
      ResourcePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { AWS: roleArn },
            Action: "secretsmanager:GetSecretValue",
            Resource: arn,
          },
        ],
      }),
      BlockPublicPolicy: true,
    }),
  );
}

export async function ensureSecrets(
  sm: SecretsManagerClient,
  consumerKeyName: string,
  rsaKeyName: string,
  consumerKey: string,
  pemPath: string,
  roleArn: string,
): Promise<void> {
  const pem = readFileSync(pemPath, "utf-8").replace(/\r\n/g, "\n");
  const ckArn = await putSecret(sm, consumerKeyName, consumerKey.trim());
  const rsaArn = await putSecret(sm, rsaKeyName, pem);
  await grantLambdaGet(sm, ckArn, roleArn);
  await grantLambdaGet(sm, rsaArn, roleArn);
}

export async function destroySecrets(sm: SecretsManagerClient, names: string[]): Promise<void> {
  for (const n of names) {
    try {
      await sm.send(new DeleteSecretCommand({ SecretId: n, ForceDeleteWithoutRecovery: true }));
    } catch (e) {
      if (!(e instanceof ResourceNotFoundException)) throw e;
    }
  }
}
