FROM node:18-slim

# Instala las dependencias necesarias para Puppeteer
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm-dev \
    libxss1 \
    libasound2 \
    libxshmfence-dev \
    xdg-utils \
    lsb-release \
    --no-install-recommends

# Establece la variable de entorno para que Puppeteer descargue Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Instala Chromium
RUN apt-get update && apt-get install -y \
    chromium

RUN npm install -g pnpm

# Crea el directorio de la app
WORKDIR /usr/src/app

# Copia los archivos de tu proyecto
COPY package*.json ./
RUN pnpm install

COPY . .

ARG PORT
ENV PORT $PORT
EXPOSE $PORT

RUN npm run build

CMD ["npm", "start"]
