#!/bin/bash
# Setup AWS Secrets Manager for Caleo production secrets.
#
# This script creates a Secrets Manager secret with placeholder values.
# After running, update the ECS task definition to reference secrets via ARN
# instead of plaintext environment variables.
#
# Usage:
#   chmod +x scripts/aws/setup-secrets-manager.sh
#   ./scripts/aws/setup-secrets-manager.sh
#
# After creating the secret:
#   1. Update values: aws secretsmanager put-secret-value --secret-id caleo/production --secret-string '{"KEY":"value",...}'
#   2. Update ECS task definition: change "environment" entries to "secrets" with valueFrom ARN
#      Example:
#        "secrets": [
#          { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:caleo/production:DATABASE_URL::" },
#          { "name": "ENCRYPTION_KEY", "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:caleo/production:ENCRYPTION_KEY::" }
#        ]
#   3. Update Lambda: retrieve secrets via AWS SDK at cold start, or use Lambda environment variable encryption

set -euo pipefail

REGION="us-east-1"
SECRET_NAME="caleo/production"

echo "Creating Secrets Manager secret: ${SECRET_NAME}"

aws secretsmanager create-secret \
  --region "${REGION}" \
  --name "${SECRET_NAME}" \
  --description "Caleo production secrets — all environment variables for ECS and Lambda" \
  --secret-string '{
    "DATABASE_URL": "ROTATE_ME",
    "ENCRYPTION_KEY": "ROTATE_ME",
    "ANTHROPIC_API_KEY": "ROTATE_ME",
    "SLACK_BOT_TOKEN": "ROTATE_ME",
    "SLACK_APP_TOKEN": "ROTATE_ME",
    "SLACK_SIGNING_SECRET": "ROTATE_ME",
    "GOOGLE_CLIENT_ID": "EXISTING_VALUE",
    "GOOGLE_CLIENT_SECRET": "ROTATE_ME",
    "MICROSOFT_APP_ID": "EXISTING_VALUE",
    "MICROSOFT_APP_PASSWORD": "ROTATE_ME",
    "STRIPE_SECRET_KEY": "ROTATE_ME",
    "STRIPE_WEBHOOK_SECRET": "ROTATE_ME",
    "OAUTH_REDIRECT_URI": "EXISTING_VALUE",
    "BILLING_BASE_URL": "EXISTING_VALUE",
    "ADMIN_NOTIFY_EMAIL": "EXISTING_VALUE",
    "NOTIFY_FROM_EMAIL": "EXISTING_VALUE",
    "SES_SMTP_USER": "EXISTING_VALUE",
    "SES_SMTP_PASS": "EXISTING_VALUE"
  }'

echo ""
echo "Secret created. Next steps:"
echo "  1. Update secret values:  aws secretsmanager put-secret-value --secret-id ${SECRET_NAME} --secret-string '{...}'"
echo "  2. Update ECS task definition to use 'secrets' field referencing Secrets Manager ARNs"
echo "  3. Grant ECS task execution role secretsmanager:GetSecretValue permission"
echo "  4. Update Lambda to retrieve secrets via AWS SDK or use Secrets Manager layer"
echo "  5. Remove plaintext env vars from ECS task definition"
