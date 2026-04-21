import { IAMClient } from "@aws-sdk/client-iam";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { STSClient } from "@aws-sdk/client-sts";

export interface AwsClients {
  iam: IAMClient;
  lambda: LambdaClient;
  s3: S3Client;
  secretsManager: SecretsManagerClient;
  sts: STSClient;
}

export function createAwsClients(region: string): AwsClients {
  const config = { region };
  return {
    iam: new IAMClient(config),
    lambda: new LambdaClient(config),
    s3: new S3Client(config),
    secretsManager: new SecretsManagerClient(config),
    sts: new STSClient(config),
  };
}
