FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --ignore-scripts --no-audit --no-fund

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
