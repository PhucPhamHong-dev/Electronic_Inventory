FROM node:20-bullseye-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates fonts-dejavu \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=4100

EXPOSE 4100

CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/server.js"]
