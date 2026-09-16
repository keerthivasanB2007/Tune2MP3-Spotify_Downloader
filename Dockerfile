FROM node:20-slim

# Install dependencies (ffmpeg, Python, and unzip)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 python3-pip curl unzip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Deno (required by yt-dlp for JS execution on Render)
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL_ROOT=/usr/local sh

# Install yt-dlp directly
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source
COPY . .

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
