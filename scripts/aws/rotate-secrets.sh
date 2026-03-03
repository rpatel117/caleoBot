#!/bin/bash
# Secret rotation execution template for Caleo production.
#
# Run each section in order. Each secret must be rotated, tested, and deployed
# before moving to the next.
#
# Usage:
#   chmod +x scripts/aws/rotate-secrets.sh
#   ./scripts/aws/rotate-secrets.sh
#
# IMPORTANT: This script is a guided template — it will prompt for confirmation
# before each rotation step.

set -euo pipefail

REGION="us-east-1"
SECRET_NAME="caleo/production"
ECS_CLUSTER="caleo-cluster"
ECS_SERVICE="caleo-bot-service"
LAMBDA_FUNCTION="caleo-agent"

confirm() {
  echo ""
  read -p "$1 [y/N] " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Skipping."
    return 1
  fi
  return 0
}

redeploy_ecs() {
  echo "Redeploying ECS service..."
  aws ecs update-service \
    --region "${REGION}" \
    --cluster "${ECS_CLUSTER}" \
    --service "${ECS_SERVICE}" \
    --force-new-deployment \
    --query 'service.serviceName' \
    --output text
  echo "ECS redeployment triggered. Monitor: aws ecs describe-services --cluster ${ECS_CLUSTER} --services ${ECS_SERVICE}"
}

echo "=== Caleo Secret Rotation ==="
echo "Region: ${REGION}"
echo "Secret: ${SECRET_NAME}"
echo ""
echo "Rotation order:"
echo "  1. DATABASE_URL password"
echo "  2. ENCRYPTION_KEY (requires token re-encryption migration)"
echo "  3. SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET"
echo "  4. ANTHROPIC_API_KEY"
echo "  5. GOOGLE_CLIENT_SECRET, MICROSOFT_APP_PASSWORD"
echo "  6. STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET"

# --- Step 1: DATABASE_URL ---
if confirm "Step 1: Rotate DATABASE_URL password? (Change in RDS console first)"; then
  echo "1. Go to RDS console and modify the caleo_admin password"
  echo "2. Enter the new DATABASE_URL:"
  read -p "New DATABASE_URL: " NEW_DB_URL
  aws secretsmanager put-secret-value \
    --region "${REGION}" \
    --secret-id "${SECRET_NAME}" \
    --secret-string "$(aws secretsmanager get-secret-value --region ${REGION} --secret-id ${SECRET_NAME} --query SecretString --output text | jq --arg v "$NEW_DB_URL" '.DATABASE_URL = $v')"
  echo "DATABASE_URL updated in Secrets Manager."
  redeploy_ecs
fi

# --- Step 2: ENCRYPTION_KEY ---
if confirm "Step 2: Rotate ENCRYPTION_KEY? (Run migration script first!)"; then
  echo "Generate new key:  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  echo ""
  echo "BEFORE updating, run the migration script against a DB snapshot:"
  echo "  OLD_ENCRYPTION_KEY=<current> NEW_ENCRYPTION_KEY=<new> DATABASE_URL=<snapshot-url> npx ts-node scripts/migrate-encryption-key.ts"
  echo ""
  echo "Then run against production:"
  echo "  OLD_ENCRYPTION_KEY=<current> NEW_ENCRYPTION_KEY=<new> DATABASE_URL=<prod-url> npx ts-node scripts/migrate-encryption-key.ts"
  echo ""
  read -p "New ENCRYPTION_KEY (64-char hex): " NEW_ENC_KEY
  aws secretsmanager put-secret-value \
    --region "${REGION}" \
    --secret-id "${SECRET_NAME}" \
    --secret-string "$(aws secretsmanager get-secret-value --region ${REGION} --secret-id ${SECRET_NAME} --query SecretString --output text | jq --arg v "$NEW_ENC_KEY" '.ENCRYPTION_KEY = $v')"
  echo "ENCRYPTION_KEY updated in Secrets Manager."
  redeploy_ecs
fi

# --- Step 3: Slack credentials ---
if confirm "Step 3: Rotate Slack credentials? (Regenerate in Slack app dashboard first)"; then
  echo "Go to https://api.slack.com/apps and regenerate tokens."
  read -p "New SLACK_BOT_TOKEN: " NEW_BOT
  read -p "New SLACK_APP_TOKEN: " NEW_APP
  read -p "New SLACK_SIGNING_SECRET: " NEW_SIGN
  aws secretsmanager put-secret-value \
    --region "${REGION}" \
    --secret-id "${SECRET_NAME}" \
    --secret-string "$(aws secretsmanager get-secret-value --region ${REGION} --secret-id ${SECRET_NAME} --query SecretString --output text | jq --arg b "$NEW_BOT" --arg a "$NEW_APP" --arg s "$NEW_SIGN" '.SLACK_BOT_TOKEN = $b | .SLACK_APP_TOKEN = $a | .SLACK_SIGNING_SECRET = $s')"
  echo "Slack credentials updated in Secrets Manager."
  redeploy_ecs
fi

# --- Step 4: Anthropic API key ---
if confirm "Step 4: Rotate ANTHROPIC_API_KEY? (Rotate in Anthropic console first)"; then
  read -p "New ANTHROPIC_API_KEY: " NEW_ANTHROPIC
  aws secretsmanager put-secret-value \
    --region "${REGION}" \
    --secret-id "${SECRET_NAME}" \
    --secret-string "$(aws secretsmanager get-secret-value --region ${REGION} --secret-id ${SECRET_NAME} --query SecretString --output text | jq --arg v "$NEW_ANTHROPIC" '.ANTHROPIC_API_KEY = $v')"
  echo "Updating Lambda..."
  aws lambda update-function-configuration \
    --region "${REGION}" \
    --function-name "${LAMBDA_FUNCTION}" \
    --environment "Variables={ANTHROPIC_API_KEY=${NEW_ANTHROPIC}}" \
    --query 'FunctionName' --output text 2>/dev/null || echo "Update Lambda env vars manually if using Secrets Manager"
  echo "ANTHROPIC_API_KEY updated."
fi

# --- Step 5: Google + Microsoft OAuth ---
if confirm "Step 5: Rotate Google/Microsoft OAuth secrets?"; then
  read -p "New GOOGLE_CLIENT_SECRET: " NEW_GOOGLE
  read -p "New MICROSOFT_APP_PASSWORD: " NEW_MS
  aws secretsmanager put-secret-value \
    --region "${REGION}" \
    --secret-id "${SECRET_NAME}" \
    --secret-string "$(aws secretsmanager get-secret-value --region ${REGION} --secret-id ${SECRET_NAME} --query SecretString --output text | jq --arg g "$NEW_GOOGLE" --arg m "$NEW_MS" '.GOOGLE_CLIENT_SECRET = $g | .MICROSOFT_APP_PASSWORD = $m')"
  echo "OAuth secrets updated."
  redeploy_ecs
fi

# --- Step 6: Stripe keys ---
if confirm "Step 6: Rotate Stripe keys? (Rotate in Stripe dashboard first)"; then
  read -p "New STRIPE_SECRET_KEY: " NEW_STRIPE
  read -p "New STRIPE_WEBHOOK_SECRET: " NEW_WEBHOOK
  aws secretsmanager put-secret-value \
    --region "${REGION}" \
    --secret-id "${SECRET_NAME}" \
    --secret-string "$(aws secretsmanager get-secret-value --region ${REGION} --secret-id ${SECRET_NAME} --query SecretString --output text | jq --arg s "$NEW_STRIPE" --arg w "$NEW_WEBHOOK" '.STRIPE_SECRET_KEY = $s | .STRIPE_WEBHOOK_SECRET = $w')"
  echo "Stripe keys updated."
  redeploy_ecs
fi

echo ""
echo "=== Rotation complete ==="
echo "Verify all services are healthy:"
echo "  curl https://your-domain.com/api/health"
echo "  aws ecs describe-services --cluster ${ECS_CLUSTER} --services ${ECS_SERVICE} --query 'services[0].runningCount'"
