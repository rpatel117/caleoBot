#!/bin/bash

# Safe Dev to Production Merge Script
# This script helps safely merge logic changes from dev to production

set -e  # Exit on any error

echo "🚀 Safe Dev to Production Merge Script"
echo "======================================"

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "❌ Error: Not in a git repository"
    exit 1
fi

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)
echo "📍 Current branch: $CURRENT_BRANCH"

# Check if we're on dev branch
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

# Get feature name
read -p "🔧 Enter feature name (e.g., 'new-calendar-feature'): " FEATURE_NAME
if [ -z "$FEATURE_NAME" ]; then
    echo "❌ Error: Feature name is required"
    exit 1
fi

echo "🔧 Feature: $FEATURE_NAME"

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  Warning: You have uncommitted changes"
    git status --short
    read -p "   Commit them first? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git add .
        git commit -m "WIP: $FEATURE_NAME"
    else
        echo "❌ Aborted: Please commit or stash your changes first"
        exit 1
    fi
fi

# Create feature branch
echo "🌿 Creating feature branch: feature/$FEATURE_NAME"
git checkout -b "feature/$FEATURE_NAME"

# Check what files will be changed
echo "📋 Files that will be changed:"
git diff --name-only HEAD~1 2>/dev/null || git diff --name-only

# Ask for confirmation
read -p "✅ Ready to create feature branch? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Aborted"
    exit 1
fi

echo "✅ Feature branch created: feature/$FEATURE_NAME"
echo ""
echo "🔧 Next steps:"
echo "1. Make your changes in this feature branch"
echo "2. Test thoroughly in dev environment"
echo "3. When ready, run: ./scripts/merge-to-prod.sh $FEATURE_NAME"
echo ""
echo "📋 Remember to avoid changing:"
echo "   - .env files"
echo "   - manifest/manifest.json (dev manifest)"
echo "   - Environment-specific URLs or IDs"
echo ""
echo "✅ Safe to change:"
echo "   - src/ directory (source code)"
echo "   - Logic improvements"
echo "   - Bug fixes"
echo "   - New features"





