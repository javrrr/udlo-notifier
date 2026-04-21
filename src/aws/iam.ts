import {
  AttachRolePolicyCommand,
  DeleteRoleCommand,
  DetachRolePolicyCommand,
  CreateRoleCommand,
  GetRoleCommand,
  NoSuchEntityException,
  type IAMClient,
} from "@aws-sdk/client-iam";
import { sleep } from "../helpers.js";

const LAMBDA_BASIC_EXECUTION_POLICY_ARN = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";

export async function ensureLambdaRole(iamClient: IAMClient, roleName: string): Promise<string> {
  try {
    const existing = await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
    if (existing.Role?.Arn) {
      return existing.Role.Arn;
    }
  } catch (e) {
    if (!(e instanceof NoSuchEntityException)) {
      throw e;
    }
  }

  await iamClient.send(
    new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "lambda.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
    }),
  );

  await iamClient.send(
    new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: LAMBDA_BASIC_EXECUTION_POLICY_ARN,
    }),
  );

  await sleep(10_000);

  const again = await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
  if (!again.Role?.Arn) {
    throw new Error(`IAM role ${roleName} was created but ARN is missing`);
  }
  return again.Role.Arn;
}

export async function destroyLambdaRole(iamClient: IAMClient, roleName: string): Promise<void> {
  try {
    await iamClient.send(
      new DetachRolePolicyCommand({
        RoleName: roleName,
        PolicyArn: LAMBDA_BASIC_EXECUTION_POLICY_ARN,
      }),
    );
  } catch (e) {
    if (!(e instanceof NoSuchEntityException)) {
      throw e;
    }
  }

  try {
    await iamClient.send(new DeleteRoleCommand({ RoleName: roleName }));
  } catch (e) {
    if (!(e instanceof NoSuchEntityException)) {
      throw e;
    }
  }
}
