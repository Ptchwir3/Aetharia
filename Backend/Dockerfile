FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY Backend/package*.json ./
RUN npm install --omit=dev
COPY Backend/Src ./Src
COPY Shared /app/Shared
RUN mkdir -p /app/data
EXPOSE 8080
CMD ["npm", "start"]
