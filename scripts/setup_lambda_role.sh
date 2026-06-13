#!/bin/bash
# Setup Lambda execution role with required permissions
# Run once before the first deployment

set -e

ROLE_NAME="oikos-ledger-lambda-role"
REGION=${AWS_REGION:-ap-south-1}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Create trust policy
cat > /tmp/trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create role
echo "Creating IAM role: ${ROLE_NAME}"
aws iam create-role \
  --role-name ${ROLE_NAME} \
  --assume-role-policy-document file:///tmp/trust-policy.json \
  --query Role.Arn \
  --output text

# Attach basic Lambda execution policy (CloudWatch Logs)
aws iam attach-role-policy \
  --role-name ${ROLE_NAME} \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Create S3 read/write policy for the uploads bucket
cat > /tmp/s3-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::oikos-ledger-uploads/*"
    }
  ]
}
EOF

# Attach S3 policy
aws iam put-role-policy \
  --role-name ${ROLE_NAME} \
  --policy-name oikos-ledger-s3-access \
  --policy-document file:///tmp/s3-policy.json

# Get role ARN
ROLE_ARN=$(aws iam get-role \
  --role-name ${ROLE_NAME} \
  --query Role.Arn \
  --output text)

echo "Role created: ${ROLE_ARN}"
echo ""
echo "Next step: attach this role to the Lambda function:"
echo "aws lambda update-function-configuration \\"
echo "  --function-name oikos-ledger-ingestion \\"
echo "  --role ${ROLE_ARN} \\"
echo "  --region ${REGION}"
