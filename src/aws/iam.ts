import {
  AttachRolePolicyCommand,
  CreateRoleCommand,
  DeleteRoleCommand,
  DetachRolePolicyCommand,
  GetRoleCommand,
  NoSuchEntityException,
  type IAMClient,
} from "@aws-sdk/client-iam";

const BASIC_EXEC = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";

const TRUST = JSON.stringify({
  Version: "2012-10-17",
  Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function ensureLambdaRole(iam: IAMClient, name: string): Promise<string> {
  try {
    const r = await iam.send(new GetRoleCommand({ RoleName: name }));
    if (r.Role?.Arn) return r.Role.Arn;
  } catch (e) {
    if (!(e instanceof NoSuchEntityException)) throw e;
  }

  await iam.send(new CreateRoleCommand({ RoleName: name, AssumeRolePolicyDocument: TRUST }));
  await iam.send(new AttachRolePolicyCommand({ RoleName: name, PolicyArn: BASIC_EXEC }));
  // IAM is eventually consistent for Lambda role assumption.
  await sleep(10_000);

  const r = await iam.send(new GetRoleCommand({ RoleName: name }));
  if (!r.Role?.Arn) throw new Error(`IAM role ${name} created but ARN missing`);
  return r.Role.Arn;
}

export async function destroyLambdaRole(iam: IAMClient, name: string): Promise<void> {
  const ignoreMissing = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof NoSuchEntityException)) throw e;
    }
  };
  await ignoreMissing(() => iam.send(new DetachRolePolicyCommand({ RoleName: name, PolicyArn: BASIC_EXEC })));
  await ignoreMissing(() => iam.send(new DeleteRoleCommand({ RoleName: name })));
}
