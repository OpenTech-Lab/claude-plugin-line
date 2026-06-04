FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY line_claude_bridge.py .
EXPOSE 8000
CMD ["uvicorn", "line_claude_bridge:app", "--host", "0.0.0.0", "--port", "8000"]
