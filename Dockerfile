FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py ./
# .env é injetado em runtime: docker run --env-file .env -p 8080:8080 ...
# (dentro do container use TELEMETRY_HOST=0.0.0.0 e defina TELEMETRY_TOKEN)
CMD ["python", "-u", "main.py"]
