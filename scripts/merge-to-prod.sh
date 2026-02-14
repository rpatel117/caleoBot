#!/bin/bash

# Merge Feature to Production Script
# This script safely merges a feature branch to production

set -e  # Exit on any error

echo "🚀 Merge Feature to Production Script"
echo "===================================="

# Check if feature name is provided
if [ -z "$1" ]; then
    echo "❌ Error: Feature name is required"
    echo "Usage: $0 <feature-name>"
    echo "Example: $0 new-calendar-feature"
    exit 1
fi

FEATURE_NAME="$1"
FEATURE_BRANCH="feature/$FEATURE_NAME"
MERGE_BRANCH="merge/$FEATURE_NAME-to-prod"

echo "🔧 Feature: $FEATURE_NAME"
echo "🌿 Feature branch: $FEATURE_BRANCH"
echo "🌿 Merge branch: $MERGE_BRANCH"

# Check if feature branch exists
if ! git show-ref --verify --quiet refs/heads/$FEATURE_BRANCH; then
    echo "❌ Error: Feature branch '$FEATURE_BRANCH' does not exist"
    echo "   Create it first with: ./scripts/safe-merge.sh $FEATURE_NAME"
    exit 1
fi

# Check if we're on dev branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "agent-clean" ]; then
    echo "⚠️  Warning: You're not on the dev branch (agent-clean)"
    echo "   Current branch: $CURRENT_BRANCH"
    read -p "   Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Aborted"
        exit 1
    fi
fi

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo "❌ Error: You have uncommitted changes"
    echo "   Please commit or stash them first"
    git status --short
    exit 1
fi

# Switch to production branch
echo "🔄 Switching to production branch..."
git checkout caleo-prod

# Create merge branch
echo "🌿 Creating merge branch: $MERGE_BRANCH"
git checkout -b "$MERGE_BRANCH"

# Merge feature branch (no commit yet)
echo "🔀 Merging feature branch..."
git merge "$FEATURE_BRANCH" --no-commit

# Show what files will be changed
echo "📋 Files that will be changed:"
git diff --cached --name-only

# Check for dangerous files
echo "🔍 Checking for dangerous files..."
DANGEROUS_FILES=$(git diff --cached --name-only | grep -E "\.(env|json)$" | grep -v "package.json" | grep -v "tsconfig.json" || true)

if [ -n "$DANGEROUS_FILES" ]; then
    echo "⚠️  Warning: The following files will be changed:"
    echo "$DANGEROUS_FILES"
    echo ""
    echo "❌ These files might contain environment-specific configurations!"
    echo "   Please review these changes carefully."
    echo ""
    read -p "   Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Aborted"
        exit 1
    fi
fi

# Show diff for review
echo "📋 Changes to be merged:"
git diff --cached --stat

read -p "✅ Review the changes above. Continue with merge? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Aborted"
    exit 1
fi

# Commit the merge
echo "💾 Committing merge..."
git commit -m "Merge feature/$FEATURE_NAME to production

- Logic changes from dev environment
- Tested in dev before merging
- Production-specific configs preserved"

echo "✅ Merge completed successfully!"
echo ""
echo "🔧 Next steps:"
echo "1. Test the merged changes:"
echo "   git checkout caleo-prod"
echo "   npm run build"
echo "   # Test locally if possible"
echo ""
echo "2. Deploy to Azure:"
echo "   # Build deployment package"
echo "   npm run build"
echo "   zip -r caleo-bot-deployment.zip dist/ package.json manifest-prod/ node_modules/"
echo "   az webapp deployment source config-zip --resource-group caleo-bot-rg --name caleo-bot-prod --src caleo-bot-deployment.zip"
echo ""
echo "3. Verify production deployment:"
echo "   curl -s https://caleo-bot-prod.azurewebsites.net/api/health"
echo "   az webapp log tail --resource-group caleo-bot-rg --name caleo-bot-prod"
echo ""
echo "4. Clean up branches:"
echo "   git branch -d $FEATURE_BRANCH"
echo "   git branch -d $MERGE_BRANCH"
echo ""
echo "🎉 Production merge completed!"





