# Changelog

All notable changes to Caleo Bot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- OpenAI Agents SDK integration planning
- Comprehensive documentation structure
- Consolidated troubleshooting guide
- Production deployment guide

### Changed
- Consolidated 18 documentation files into 10 organized files
- Improved code organization and file structure
- Enhanced security by moving secrets to .env file

### Removed
- Redundant documentation files
- Hardcoded secrets from template files
- Duplicate troubleshooting guides

## [1.0.0] - 2025-10-03

### Added
- Microsoft Teams Bot Framework integration
- OpenAI GPT-4o-mini integration
- Supabase database integration with persistent authentication
- Microsoft Graph API calendar access
- Teams Single Sign-On (SSO) authentication
- Intelligent calendar context system
- Time zone handling for calendar events
- Encryption service for secure token storage
- Comprehensive error handling and logging
- Health check endpoints
- TypeScript implementation with strict typing

### Technical Features
- **Authentication**: Persistent OAuth token storage with 10-year expiry
- **Calendar Integration**: Real-time calendar event retrieval and display
- **AI Context**: Smart calendar context injection based on user queries
- **Database**: PostgreSQL with Supabase, Row Level Security (RLS)
- **Security**: Encrypted token storage, secure API key management
- **Performance**: Optimized API calls, connection pooling
- **Monitoring**: Comprehensive logging and health checks

### Documentation
- Complete setup and installation guide
- API reference with examples
- Troubleshooting guide with common issues
- Development workflow and coding standards
- Deployment guide for multiple platforms
- Architecture documentation
- Microsoft Graph integration guide
- Supabase integration guide

### File Structure
```
caleoBot/
├── src/                    # Source code (6 consolidated files)
│   ├── index.ts           # Main bot server
│   ├── ai-service.ts      # AI service integration
│   ├── teams-sso-service.ts # Teams authentication
│   ├── graph-service.ts   # Microsoft Graph API
│   ├── database.ts        # Database service
│   └── encryption.ts      # Encryption utilities
├── notes/                 # Documentation (10 organized files)
│   ├── README.md          # Documentation overview
│   ├── SETUP.md           # Complete setup guide
│   ├── API_REFERENCE.md   # API documentation
│   ├── TROUBLESHOOTING.md # Issue resolution
│   ├── DEVELOPMENT.md     # Development guide
│   ├── DEPLOYMENT.md      # Deployment guide
│   ├── ARCHITECTURE.md    # System architecture
│   ├── MICROSOFT_GRAPH.md # Graph API integration
│   ├── SUPABASE.md        # Database integration
│   ├── ROADMAP.md         # Development roadmap
│   └── CHANGELOG.md       # This file
├── manifest/              # Teams app manifest
├── prisma/                # Database schema
├── .env                   # Environment variables (secrets)
└── dist/                  # Compiled JavaScript
```

### Security Improvements
- Moved all secrets to .env file with .gitignore protection
- Implemented encrypted token storage
- Added comprehensive input validation
- Enhanced error handling to prevent information leakage
- Configured Row Level Security (RLS) in Supabase

### Performance Optimizations
- Implemented connection pooling for database
- Added response caching for AI service
- Optimized Graph API calls with proper error handling
- Added time zone conversion for calendar events
- Implemented intelligent context filtering

### Bug Fixes
- Fixed token persistence issues with Supabase integration
- Resolved time zone conversion problems for calendar events
- Fixed Graph API date parsing for 7-decimal-place UTC format
- Corrected authentication flow for Teams SSO
- Fixed duplicate message handling in bot responses

### Known Issues
- Bot occasionally shows incorrect date for simple date questions (resolved in agent architecture)
- Calendar context sometimes includes irrelevant events (improved with intelligent filtering)
- Token expiry handling needs refinement (addressed with 10-year expiry)

## [0.9.0] - 2025-09-30

### Added
- Initial bot framework setup
- Basic OpenAI integration
- Microsoft Teams authentication
- Calendar access functionality

### Technical Debt
- Multiple duplicate service files
- Hardcoded secrets in code
- Inconsistent error handling
- Missing comprehensive documentation
- No persistent authentication

## [0.8.0] - 2025-09-29

### Added
- Project initialization
- Basic TypeScript setup
- Microsoft Bot Framework integration
- OpenAI API integration

---

## Version Numbering

- **Major** (X.0.0): Breaking changes, major feature additions
- **Minor** (0.X.0): New features, non-breaking changes
- **Patch** (0.0.X): Bug fixes, minor improvements

## Release Process

1. Update version numbers in package.json
2. Update this changelog
3. Create git tag for the version
4. Deploy to production
5. Create GitHub release

---

*This changelog is maintained by the development team and updated with each release.*

*Last updated: October 3, 2025*
