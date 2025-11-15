# Use official Node.js image
FROM node:18

# Set working directory
WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all frontend files
COPY . .

# Build: expose default frontend port (can vary)
EXPOSE 3500

# Run the development server (you can change to "serve Public" if needed)
CMD ["npx", "serve", "Public"]
