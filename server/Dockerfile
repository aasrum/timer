FROM node:22-slim
WORKDIR /app

# better-sqlite3 kompilerer en native modul; python3/make/g++ trengs for det.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "src/index.js"]
