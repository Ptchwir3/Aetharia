FROM node:18-slim

WORKDIR /app

COPY Backend/package*.json ./

RUN npm install --production

COPY Backend/Src ./Src

COPY Shared /app/Shared

EXPOSE 8080

CMD ["npm", "start"]
