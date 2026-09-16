FROM node:20-slim

# Install dependencies (ffmpeg, Python, and unzip)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 python3-pip curl unzip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Deno v2.3.0 (required by yt-dlp for JS execution on Render)
RUN curl -fL https://github.com/denoland/deno/releases/download/v2.3.0/deno-x86_64-unknown-linux-gnu.zip -o deno.zip && \
    unzip deno.zip && \
    rm deno.zip && \
    chmod +x deno && \
    mv deno /usr/local/bin/deno

# Rigid Validation Check
RUN /usr/local/bin/deno --version && /usr/local/bin/deno eval "console.log('DENO_OK')"

ENV PATH="/usr/local/bin:${PATH}"

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
