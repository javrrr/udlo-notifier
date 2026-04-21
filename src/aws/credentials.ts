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
        "AWS credentials are missing or invalid. The SDK could not load any credential source.\n" +
          "  • Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (and AWS_SESSION_TOKEN if using temporary keys), or\n" +
          "  • Use a profile: export AWS_PROFILE=your-profile (then `aws sso login` or `aws login` for that profile if needed), or\n" +
          "  • If credentials live only in ~/.aws/config, try: export AWS_SDK_LOAD_CONFIG=1\n" +
          "  • Verify with: aws sts get-caller-identity --region <same-region-as---aws-region>\n" +
          "Original: " +
          e.message,
      );
    }
    throw new Error(
      `Could not verify AWS identity via STS: ${e instanceof Error ? e.message : String(e)}. ` +
        "Confirm credentials are not expired.",
    );
  }
}
