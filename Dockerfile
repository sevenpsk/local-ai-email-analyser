# ==========================================
# Stage 1: Build the frontend React client
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package descriptors first to leverage caching
COPY package*.json ./

# Install dependencies (development included for build step)
RUN npm ci

# Copy all source files
COPY . .

# Build Vite frontend assets (outputs to /app/dist)
RUN npm run build

# ==========================================
# Stage 2: Serve Express server in production
# ==========================================
FROM node:20-alpine

WORKDIR /app

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Copy package descriptors for backend dependencies
COPY package*.json ./

# Install only production dependencies (no devDependencies like Vite/Concurrently)
RUN npm ci --only=production && npm cache clean --force

# Copy server entrypoints & db manager
COPY server.js db.js ./

# Copy built frontend assets from the builder stage
COPY --from=builder /app/dist ./dist

# Create storage directory for databases
RUN mkdir -p /app/data

# Expose port
EXPOSE 3001

# Start the application
CMD ["node", "server.js"]
