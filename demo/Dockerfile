FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm install --omit=dev
COPY . .
RUN mkdir -p /app/data /app/uploads /app/public/vendor \
 && cp node_modules/admin-lte/dist/css/adminlte.min.css public/vendor/adminlte.min.css \
 && cp node_modules/bootstrap/dist/css/bootstrap.min.css public/vendor/bootstrap.min.css \
 && cp node_modules/admin-lte/dist/js/adminlte.min.js public/vendor/adminlte.min.js \
 && cp node_modules/bootstrap/dist/js/bootstrap.bundle.min.js public/vendor/bootstrap.bundle.min.js \
 && cp node_modules/bootstrap-icons/font/bootstrap-icons.min.css public/vendor/bootstrap-icons.min.css \
 && cp -r node_modules/bootstrap-icons/font/fonts public/vendor/fonts
ENV NODE_ENV=production PORT=7001 DATA_DIR=/app/data UPLOAD_DIR=/app/uploads
EXPOSE 7001
CMD ["npx", "egg-scripts", "start", "--framework=/app/framework", "--workers=2", "--title=cloud-risk-demo"]
