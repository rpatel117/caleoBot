#!/bin/bash
# Setup CloudWatch alarms for Caleo production monitoring.
#
# Prerequisites:
#   - SNS topic for alarm notifications (created below if not exists)
#   - Appropriate IAM permissions
#
# Usage:
#   chmod +x scripts/aws/setup-cloudwatch-alarms.sh
#   ./scripts/aws/setup-cloudwatch-alarms.sh

set -euo pipefail

REGION="us-east-1"
ECS_CLUSTER="caleo-cluster"
ECS_SERVICE="caleo-bot-service"
LAMBDA_FUNCTION="caleo-agent"
RDS_INSTANCE="caleo-db"
SNS_TOPIC_NAME="caleo-alerts"
ALARM_EMAIL="${ADMIN_NOTIFY_EMAIL:-}"

echo "=== Setting up CloudWatch alarms for Caleo ==="

# --- Create SNS topic ---
echo "Creating SNS topic: ${SNS_TOPIC_NAME}"
TOPIC_ARN=$(aws sns create-topic \
  --region "${REGION}" \
  --name "${SNS_TOPIC_NAME}" \
  --query 'TopicArn' --output text)
echo "SNS Topic ARN: ${TOPIC_ARN}"

if [ -n "${ALARM_EMAIL}" ]; then
  echo "Subscribing ${ALARM_EMAIL} to alerts..."
  aws sns subscribe \
    --region "${REGION}" \
    --topic-arn "${TOPIC_ARN}" \
    --protocol email \
    --notification-endpoint "${ALARM_EMAIL}"
  echo "Confirmation email sent — check inbox and confirm subscription."
fi

# --- ECS CPU > 80% for 5 min ---
echo "Creating alarm: caleo-ecs-cpu-high"
aws cloudwatch put-metric-alarm \
  --region "${REGION}" \
  --alarm-name "caleo-ecs-cpu-high" \
  --alarm-description "ECS CPU utilization > 80% for 5 minutes" \
  --namespace "AWS/ECS" \
  --metric-name "CPUUtilization" \
  --dimensions "Name=ClusterName,Value=${ECS_CLUSTER}" "Name=ServiceName,Value=${ECS_SERVICE}" \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions "${TOPIC_ARN}" \
  --treat-missing-data notBreaching

# --- ECS Memory > 80% for 5 min ---
echo "Creating alarm: caleo-ecs-memory-high"
aws cloudwatch put-metric-alarm \
  --region "${REGION}" \
  --alarm-name "caleo-ecs-memory-high" \
  --alarm-description "ECS memory utilization > 80% for 5 minutes" \
  --namespace "AWS/ECS" \
  --metric-name "MemoryUtilization" \
  --dimensions "Name=ClusterName,Value=${ECS_CLUSTER}" "Name=ServiceName,Value=${ECS_SERVICE}" \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions "${TOPIC_ARN}" \
  --treat-missing-data notBreaching

# --- RDS Connections > 15 for 5 min (pool max is 20) ---
echo "Creating alarm: caleo-rds-connections-high"
aws cloudwatch put-metric-alarm \
  --region "${REGION}" \
  --alarm-name "caleo-rds-connections-high" \
  --alarm-description "RDS connections > 15 for 5 minutes (pool max is 20)" \
  --namespace "AWS/RDS" \
  --metric-name "DatabaseConnections" \
  --dimensions "Name=DBInstanceIdentifier,Value=${RDS_INSTANCE}" \
  --statistic Average \
  --period 300 \
  --threshold 15 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions "${TOPIC_ARN}" \
  --treat-missing-data notBreaching

# --- Lambda Errors > 5 in 5 min ---
echo "Creating alarm: caleo-lambda-errors"
aws cloudwatch put-metric-alarm \
  --region "${REGION}" \
  --alarm-name "caleo-lambda-errors" \
  --alarm-description "Lambda errors > 5 in 5 minutes" \
  --namespace "AWS/Lambda" \
  --metric-name "Errors" \
  --dimensions "Name=FunctionName,Value=${LAMBDA_FUNCTION}" \
  --statistic Sum \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions "${TOPIC_ARN}" \
  --treat-missing-data notBreaching

# --- Lambda Duration P95 > 10s (cold start monitoring) ---
echo "Creating alarm: caleo-lambda-duration-p95"
aws cloudwatch put-metric-alarm \
  --region "${REGION}" \
  --alarm-name "caleo-lambda-duration-p95" \
  --alarm-description "Lambda P95 duration > 10 seconds (cold start indicator)" \
  --namespace "AWS/Lambda" \
  --metric-name "Duration" \
  --dimensions "Name=FunctionName,Value=${LAMBDA_FUNCTION}" \
  --extended-statistic "p95" \
  --period 300 \
  --threshold 10000 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions "${TOPIC_ARN}" \
  --treat-missing-data notBreaching

echo ""
echo "=== CloudWatch alarms created ==="
echo "View in console: https://${REGION}.console.aws.amazon.com/cloudwatch/home?region=${REGION}#alarmsV2:"
echo ""
echo "To add PagerDuty integration:"
echo "  1. Create a PagerDuty service and get the integration URL"
echo "  2. Subscribe the SNS topic to the PagerDuty HTTPS endpoint:"
echo "     aws sns subscribe --topic-arn ${TOPIC_ARN} --protocol https --notification-endpoint <pagerduty-url>"
