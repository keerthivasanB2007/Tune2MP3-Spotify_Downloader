FROM node:22-slim

# Install dependencies (ffmpeg, Python, git, and unzip)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 python3-pip git curl unzip && \
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

# Install yt-dlp and bgutil-ytdlp-pot-provider plugin
RUN pip3 install --no-cache-dir --break-system-packages -U yt-dlp bgutil-ytdlp-pot-provider

# Build bgutil-ytdlp-pot-provider server
RUN git clone --single-branch https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider && \
    cd /opt/bgutil-ytdlp-pot-provider/server && \
    npm ci && \
    npx tsc

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

