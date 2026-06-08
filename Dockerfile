# ---- Build stage: build the React frontend -------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
COPY desktop/package.json ./desktop/package.json
RUN npm ci

COPY web ./web
COPY server ./server
RUN npm run build

# ---- Runtime stage: Fastify server + prebuilt SPA ------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    STATIC_DIR=/app/web/dist \
    GO2RTC_API_URL=http://go2rtc:1984

# Production server dependencies only.
COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev && npm cache clean --force

COPY server/src ./server/src
COPY --from=build /app/web/dist ./web/dist

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080

WORKDIR /app/server
CMD ["node", "src/index.js"]
