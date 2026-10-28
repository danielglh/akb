FROM node:24.22.1-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ripgrep ca-certificates python3 make g++ cmake libgomp1 \
    && rm -rf /var/lib/apt/lists/*

ENV QMD_FORCE_CPU=1
ENV QMD_LLAMA_GPU=false
RUN npm install --prefix /opt/qmd @tobilu/qmd@2.8.3 --no-audit --no-fund
ENV PATH="/opt/qmd/node_modules/.bin:${PATH}"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

CMD ["bash", "scripts/linux-container-check.sh"]
