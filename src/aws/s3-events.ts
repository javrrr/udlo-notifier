import {
  GetBucketNotificationConfigurationCommand,
  PutBucketNotificationConfigurationCommand,
  type LambdaFunctionConfiguration,
  type NotificationConfiguration,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  AddPermissionCommand,
  type LambdaClient,
  ResourceConflictException,
} from "@aws-sdk/client-lambda";

function prefixFilter(directory: string): LambdaFunctionConfiguration["Filter"] {
  const prefix = directory.endsWith("/") ? directory : `${directory}/`;
  return {
    Key: {
      FilterRules: [{ Name: "prefix", Value: prefix }],
    },
  };
}

function notificationAlreadyExists(
  existing: LambdaFunctionConfiguration[] | undefined,
  lambdaFunctionArn: string,
  directory: string,
): boolean {
  const wantPrefix = (directory.endsWith("/") ? directory : `${directory}/`).toLowerCase();
  for (const cfg of existing ?? []) {
    if (cfg.LambdaFunctionArn !== lambdaFunctionArn) {
      continue;
    }
    const rules = cfg.Filter?.Key?.FilterRules ?? [];
    for (const r of rules) {
      if (r.Name === "prefix" && (r.Value ?? "").toLowerCase() === wantPrefix) {
        return true;
      }
    }
  }
  return false;
}

export async function configureS3Events(
  s3Client: S3Client,
  lambdaClient: LambdaClient,
  bucket: string,
  directory: string,
  lambdaFunctionArn: string,
  awsAccountId: string,
): Promise<void> {
  const statementId = `s3-udlo-${bucket.replace(/[^a-zA-Z0-9-]/g, "-")}-${Date.now()}`.slice(0, 100);

  try {
    await lambdaClient.send(
      new AddPermissionCommand({
        FunctionName: lambdaFunctionArn,
        StatementId: statementId,
        Action: "lambda:InvokeFunction",
        Principal: "s3.amazonaws.com",
        SourceArn: `arn:aws:s3:::${bucket}`,
        SourceAccount: awsAccountId,
      }),
    );
  } catch (e) {
    if (!(e instanceof ResourceConflictException)) {
      throw e;
    }
  }

  const current = await s3Client.send(new GetBucketNotificationConfigurationCommand({ Bucket: bucket }));
  const lambdaConfigs = [...(current.LambdaFunctionConfigurations ?? [])];

  if (!notificationAlreadyExists(lambdaConfigs, lambdaFunctionArn, directory)) {
    lambdaConfigs.push({
      LambdaFunctionArn: lambdaFunctionArn,
      Events: ["s3:ObjectCreated:*"],
      Filter: prefixFilter(directory),
    });
  }

  const merged: NotificationConfiguration = {
    ...current,
    LambdaFunctionConfigurations: lambdaConfigs,
  };

  await s3Client.send(
    new PutBucketNotificationConfigurationCommand({
      Bucket: bucket,
      NotificationConfiguration: merged,
      SkipDestinationValidation: true,
    }),
  );
}

export async function removeS3Events(
  s3Client: S3Client,
  bucket: string,
  lambdaFunctionArn: string,
): Promise<void> {
  const current = await s3Client.send(new GetBucketNotificationConfigurationCommand({ Bucket: bucket }));
  const lambdaConfigs = (current.LambdaFunctionConfigurations ?? []).filter(
    (c) => c.LambdaFunctionArn !== lambdaFunctionArn,
  );

  const merged: NotificationConfiguration = {
    ...current,
    LambdaFunctionConfigurations: lambdaConfigs.length > 0 ? lambdaConfigs : undefined,
  };

  await s3Client.send(
    new PutBucketNotificationConfigurationCommand({
      Bucket: bucket,
      NotificationConfiguration: merged,
      SkipDestinationValidation: true,
    }),
  );
}
