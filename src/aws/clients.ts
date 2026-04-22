import { IAMClient } from "@aws-sdk/client-iam";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { fromIni } from "@aws-sdk/credential-providers";

export interface AwsClients {
  iam: IAMClient;
  lambda: LambdaClient;
  s3: S3Client;
  secrets: SecretsManagerClient;
  sts: STSClient;
}

export function createAwsClients(region: string, profile?: string): AwsClients {
  const config = { region, ...(profile ? { credentials: fromIni({ profile }) } : {}) };
  return {
    iam: new IAMClient(config),
    lambda: new LambdaClient(config),
    s3: new S3Client(config),
    secrets: new SecretsManagerClient(config),
    sts: new STSClient(config),
  };
}

export async function getAwsAccountId(sts: STSClient): Promise<string> {
  const out = await sts.send(new GetCallerIdentityCommand({}));
  if (!out.Account) {
    throw new Error("AWS STS returned no Account. Check credentials (env vars, --aws-profile, or AWS_PROFILE).");
  }
  return out.Account;
}
