FROM node:18-slim

WORKDIR /app

COPY AI_Agents/package*.json ./

RUN npm install --production

COPY AI_Agents/ ./

EXPOSE 7000

CMD ["npm", "start"]
