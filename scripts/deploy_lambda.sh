#!/bin/bash
# Deploy ingestion pipeline to AWS Lambda as container image
# Usage: ./scripts/deploy_lambda.sh
# Requires: Docker, AWS CLI configured, .env.local with AWS credentials

set -e

# Load environment variables from .env.local
source .env.local

REGION=${AWS_REGION:-ap-south-1}
FUNCTION_NAME=${AWS_LAMBDA_FUNCTION_NAME:-oikos-ledger-ingestion}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="oikos-ledger-ingestion"
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}"

echo "Deploying to Lambda: ${FUNCTION_NAME} in ${REGION}"
echo "Account: ${ACCOUNT_ID}"

# Step 1: Create ECR repository if it doesn't exist
echo "Creating ECR repository..."
aws ecr describe-repositories \
  --repository-names ${ECR_REPO} \
  --region ${REGION} 2>/dev/null || \
aws ecr create-repository \
  --repository-name ${ECR_REPO} \
  --region ${REGION}

# Step 2: Authenticate Docker to ECR
echo "Authenticating Docker to ECR..."
aws ecr get-login-password \
  --region ${REGION} | \
docker login \
  --username AWS \
  --password-stdin \
  ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com

# Step 3: Build Docker image
echo "Building Docker image..."
docker build \
  --platform linux/amd64 \
  --provenance=false \
  --output type=docker \
  -t ${ECR_REPO}:latest \
  -f ingestion/Dockerfile \
  ingestion/

# Step 4: Tag image for ECR
echo "Tagging image..."
docker tag ${ECR_REPO}:latest ${ECR_URI}:latest

# Step 5: Push image to ECR
echo "Pushing image to ECR..."
docker push ${ECR_URI}:latest

# Step 6: Update Lambda function to use new image
echo "Updating Lambda function code..."
aws lambda update-function-code \
  --function-name ${FUNCTION_NAME} \
  --image-uri ${ECR_URI}:latest \
  --region ${REGION} \
  --output text \
  --query 'FunctionName'

# Step 7: Wait for code update to complete
echo "Waiting for Lambda code update..."
aws lambda wait function-updated \
  --function-name ${FUNCTION_NAME} \
  --region ${REGION} \
  --output text \
  --query 'FunctionName'


# Step 8: Update Lambda runtime configuration
echo "Updating Lambda configuration..."
aws lambda update-function-configuration \
  --function-name ${FUNCTION_NAME} \
  --timeout 300 \
  --memory-size 512 \
  --region ${REGION} \
  --output text \
  --query 'FunctionName'


# Wait before setting env vars — two update-function-configuration calls
# cannot overlap; Lambda rejects the second while the first is in progress.
echo "Waiting for Lambda configuration update..."
aws lambda wait function-updated \
  --function-name ${FUNCTION_NAME} \
  --region ${REGION} \
  --output text \
  --query 'FunctionName'

# Step 9: Set environment variables
echo "Setting environment variables..."
aws lambda update-function-configuration \
  --function-name ${FUNCTION_NAME} \
  --region ${REGION} \
  --environment "Variables={DATABASE_URL=${DATABASE_URL},DATABASE_URL_DIRECT=${DATABASE_URL_DIRECT},DB_PROVIDER=${DB_PROVIDER:-supabase},OPENAI_API_KEY=${OPENAI_API_KEY},ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY},AWS_S3_BUCKET=${AWS_S3_BUCKET}}" \
  --output text \
  --query 'FunctionName'

echo ""
echo "Deployment complete!"
echo "Lambda function: ${FUNCTION_NAME}"
echo "Image: ${ECR_URI}:latest"
