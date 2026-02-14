FROM public.ecr.aws/docker/library/node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

EXPOSE 3000

CMD ["node", "dist/slack/index.js"]
