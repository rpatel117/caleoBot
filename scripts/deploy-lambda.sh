#!/bin/bash
set -e

FUNCTION_NAME="${1:-caleo-agent}"

echo "Building..."
npm run build

echo "Packaging Lambda deployment..."
cd dist
zip -r ../lambda.zip . -x "slack/*"
cd ..
zip -r lambda.zip node_modules/ -x "node_modules/@slack/*" "node_modules/nodemon/*"

echo "Deploying to Lambda: $FUNCTION_NAME..."
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file fileb://lambda.zip

echo "Cleaning up..."
rm lambda.zip

echo "Deployed successfully."
