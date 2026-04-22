import { IAMClient } from "@aws-sdk/client-iam";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { STSClient } from "@aws-sdk/client-sts";
import { fromIni } from "@aws-sdk/credential-providers";

export interface AwsClients {
  iam: IAMClient;
  lambda: LambdaClient;
  s3: S3Client;
  secretsManager: SecretsManagerClient;
  sts: STSClient;
}

export interface CreateAwsClientsOptions {
  /** Named profile from ~/.aws/credentials (optional). */
  profile?: string;
}

export function createAwsClients(region: string, options?: CreateAwsClientsOptions): AwsClients {
  const profile = options?.profile?.trim();
  const config = {
    region,
    ...(profile ? { credentials: fromIni({ profile }) } : {}),
  };
  return {
    iam: new IAMClient(config),
    lambda: new LambdaClient(config),
    s3: new S3Client(config),
    secretsManager: new SecretsManagerClient(config),
    sts: new STSClient(config),
  };
}
