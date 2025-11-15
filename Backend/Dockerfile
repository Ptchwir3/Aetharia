# Use official Node.js LTS image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package.json + lock file
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy rest of the backend code
COPY . .

# Expose the backend port
EXPOSE 8080

# Start the server
CMD ["npm", "start"]
 
