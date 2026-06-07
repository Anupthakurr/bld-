FROM node:20-slim

# Install Chromium and required system dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r chromium && useradd -r -g chromium -G audio,video chromium \
    && mkdir -p /home/chromium/Downloads \
    && chown -R chromium:chromium /home/chromium

USER chromium

EXPOSE 9222

# Launch Chromium in headless mode with CDP exposed on all interfaces
CMD ["chromium", \
    "--headless=new", \
    "--no-sandbox", \
    "--disable-setuid-sandbox", \
    "--disable-dev-shm-usage", \
    "--disable-gpu", \
    "--disable-software-rasterizer", \
    "--remote-debugging-port=9222", \
    "--remote-debugging-address=0.0.0.0", \
    "--window-size=1280,720", \
    "--hide-scrollbars", \
    "--mute-audio", \
    "--no-first-run", \
    "--no-default-browser-check", \
    "--disable-extensions", \
    "--disable-translate", \
    "about:blank"]
