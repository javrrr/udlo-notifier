import { GetCallerIdentityCommand, type STSClient } from "@aws-sdk/client-sts";

export async function verifyAwsCredentials(stsClient: STSClient): Promise<{ accountId: string; arn: string }> {
  try {
    const out = await stsClient.send(new GetCallerIdentityCommand({}));
    const accountId = out.Account;
    const arn = out.Arn;
    if (!accountId || !arn) {
      throw new Error("STS GetCallerIdentity returned no Account or Arn. Check AWS credentials.");
    }
    return { accountId, arn };
  } catch (e) {
    if (e instanceof Error && e.name === "CredentialsProviderError") {
      throw new Error(
        "AWS credentials are missing or invalid. Configure AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, " +
          "or run `aws sso login`, or set AWS_PROFILE before running this command.",
      );
    }
    throw new Error(
      `Could not verify AWS identity via STS: ${e instanceof Error ? e.message : String(e)}. ` +
        "Confirm credentials are not expired.",
    );
  }
}
