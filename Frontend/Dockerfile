FROM node:18-slim

WORKDIR /app

COPY Frontend/package*.json ./

RUN npm install --production

COPY Frontend/Public ./Public

EXPOSE 3500

CMD ["npx", "serve", "Public", "-l", "3500"]
