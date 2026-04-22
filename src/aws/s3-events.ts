import {
  GetBucketNotificationConfigurationCommand,
  PutBucketNotificationConfigurationCommand,
  type LambdaFunctionConfiguration,
  type S3Client,
} from "@aws-sdk/client-s3";
import { AddPermissionCommand, ResourceConflictException, type LambdaClient } from "@aws-sdk/client-lambda";

export function s3KeyPrefix(directory: string): string {
  const d = directory.trim();
  if (!d) return "";
  return d.endsWith("/") ? d : `${d}/`;
}

const UDLO_ARN_PATTERN = /:function:udlo-notifier-[a-z0-9]+-fn$/;
const isOursOrStale = (arn: string | undefined, selfArn: string): boolean =>
  arn === selfArn || (arn !== undefined && UDLO_ARN_PATTERN.test(arn));

function describeRule(c: LambdaFunctionConfiguration): string {
  const prefix = c.Filter?.Key?.FilterRules?.find((r) => r.Name === "prefix")?.Value ?? "";
  const suffix = c.Filter?.Key?.FilterRules?.find((r) => r.Name === "suffix")?.Value ?? "";
  return `${c.LambdaFunctionArn} prefix="${prefix}" suffix="${suffix}" events=${(c.Events ?? []).join(",")}`;
}

export async function configureS3Events(
  s3: S3Client,
  lambda: LambdaClient,
  bucket: string,
  directory: string,
  lambdaArn: string,
  accountId: string,
): Promise<void> {
  try {
    await lambda.send(
      new AddPermissionCommand({
        FunctionName: lambdaArn,
        StatementId: `s3-${bucket.replace(/[^a-zA-Z0-9-]/g, "-")}-${Date.now()}`.slice(0, 100),
        Action: "lambda:InvokeFunction",
        Principal: "s3.amazonaws.com",
        SourceArn: `arn:aws:s3:::${bucket}`,
        SourceAccount: accountId,
      }),
    );
  } catch (e) {
    if (!(e instanceof ResourceConflictException)) throw e;
  }

  const current = await s3.send(new GetBucketNotificationConfigurationCommand({ Bucket: bucket }));
  const prefix = s3KeyPrefix(directory);
  const rule: LambdaFunctionConfiguration = {
    LambdaFunctionArn: lambdaArn,
    Events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"],
    ...(prefix ? { Filter: { Key: { FilterRules: [{ Name: "prefix", Value: prefix }] } } } : {}),
  };

  // S3 rejects overlapping prefix/suffix rules for the same event. Drop rules pointing at the
  // current Lambda *and* any stale `udlo-notifier-*-fn` rules left over from previous setups
  // (e.g. when state was wiped and the deployment suffix rotated).
  const existing = current.LambdaFunctionConfigurations ?? [];
  const kept = existing.filter((c) => !isOursOrStale(c.LambdaFunctionArn, lambdaArn));
  const merged = [...kept, rule];

  try {
    await s3.send(
      new PutBucketNotificationConfigurationCommand({
        Bucket: bucket,
        NotificationConfiguration: { ...current, LambdaFunctionConfigurations: merged },
        SkipDestinationValidation: true,
      }),
    );
  } catch (e) {
    if (e instanceof Error && /overlapping|ambiguously/i.test(e.message)) {
      const conflicts = kept.map((c) => `  - ${describeRule(c)}`).join("\n");
      throw new Error(
        `${e.message}\n\nBucket "${bucket}" has notification rules whose prefix/suffix filters overlap with this Lambda's ` +
          `(prefix "${prefix || "(root)"}", events s3:ObjectCreated:*). Remove or narrow the conflicting rule(s) in the ` +
          `S3 console (Properties > Event notifications) before re-running setup:\n${conflicts || "  (none detected — check SQS/SNS rules)"}`,
      );
    }
    throw e;
  }
}

export async function removeS3Events(s3: S3Client, bucket: string, lambdaArn: string): Promise<void> {
  const current = await s3.send(new GetBucketNotificationConfigurationCommand({ Bucket: bucket }));
  const remaining = (current.LambdaFunctionConfigurations ?? []).filter((c) => !isOursOrStale(c.LambdaFunctionArn, lambdaArn));
  await s3.send(
    new PutBucketNotificationConfigurationCommand({
      Bucket: bucket,
      NotificationConfiguration: {
        ...current,
        LambdaFunctionConfigurations: remaining.length > 0 ? remaining : undefined,
      },
      SkipDestinationValidation: true,
    }),
  );
}
