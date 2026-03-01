FROM public.ecr.aws/docker/library/node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nodejs
USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3000/api/health || exit 1

CMD ["node", "dist/slack/index.js"]
