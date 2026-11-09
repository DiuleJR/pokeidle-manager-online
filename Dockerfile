# Opcional: a forma recomendada é rodar com Python direto (veja o README).
# Estágio 1: compila o dashboard.
FROM node:20-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Estágio 2: o bot + painel.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py ./
COPY --from=web /web/dist ./web_dist
# Contas e tokens ficam em /data (monte um volume; veja docker-compose.yml).
ENV DATA_DIR=/data TELEMETRY_HOST=0.0.0.0 TELEMETRY_PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["python", "-u", "main.py"]
