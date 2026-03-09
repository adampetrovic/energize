FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --production

FROM node:20-alpine
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY server.js ./
COPY lib/ ./lib/
COPY public/ ./public/

ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "server.js"]
