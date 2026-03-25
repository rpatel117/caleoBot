FROM public.ecr.aws/docker/library/node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

# Download RDS CA bundle for SSL certificate pinning
RUN wget -q -O /app/rds-combined-ca-bundle.pem \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nodejs
USER nodejs

ENV RDS_CA_CERT_PATH=/app/rds-combined-ca-bundle.pem

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3000/api/health || exit 1

CMD ["node", "dist/slack/index.js"]
