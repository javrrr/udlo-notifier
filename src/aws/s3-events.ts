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

/**
 * S3 notification prefix for object keys under a logical folder. Empty = whole bucket (no prefix filter).
 * Trailing slash matches Data Cloud UDLO directory conventions (e.g. `afd360/`).
 */
export function s3KeyPrefixForNotifications(relativeDirectory: string): string {
  const d = relativeDirectory.trim();
  if (d === "") {
    return "";
  }
  return d.endsWith("/") ? d : `${d}/`;
}

/** No filter → S3 delivers all object-created events for the bucket to this Lambda. */
function prefixFilter(directory: string): LambdaFunctionConfiguration["Filter"] | undefined {
  const prefix = s3KeyPrefixForNotifications(directory);
  if (prefix === "") {
    return undefined;
  }
  return {
    Key: {
      FilterRules: [{ Name: "prefix", Value: prefix }],
    },
  };
}

/**
 * S3 rejects the whole notification if two Lambda rules use the same event types and their
 * prefix/suffix filters overlap. Multiple rules for the *same* destination (e.g. whole bucket
 * from an earlier setup plus a prefix rule) always overlap — keep at most one rule per Lambda ARN.
 */
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
  const filter = prefixFilter(directory);
  const newRule: LambdaFunctionConfiguration = {
    LambdaFunctionArn: lambdaFunctionArn,
    Events: ["s3:ObjectCreated:*"],
    ...(filter ? { Filter: filter } : {}),
  };
  const lambdaConfigs = (current.LambdaFunctionConfigurations ?? []).filter(
    (c) => c.LambdaFunctionArn !== lambdaFunctionArn,
  );
  lambdaConfigs.push(newRule);

  const merged: NotificationConfiguration = {
    ...current,
    LambdaFunctionConfigurations: lambdaConfigs,
  };

  try {
    await s3Client.send(
      new PutBucketNotificationConfigurationCommand({
        Bucket: bucket,
        NotificationConfiguration: merged,
        SkipDestinationValidation: true,
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    if (/InvalidArgument|overlapping suffixes|ambiguously defined/i.test(msg)) {
      throw new Error(
        `${msg}\n` +
          "Another Lambda (or SQS/SNS) notification on this bucket uses overlapping prefix/suffix filters " +
          "for the same object events. Remove or narrow the conflicting rule in the S3 console " +
          "(Event notifications), or use a dedicated bucket for this pipeline.",
      );
    }
    throw e;
  }
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
