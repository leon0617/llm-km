FROM python:3.9-slim

WORKDIR /app

# 安裝系統依賴
RUN apt-get update && apt-get install -y \
    libgomp1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 複製依賴檔案
COPY requirements.txt .

# 安裝 Python 依賴
RUN pip install --no-cache-dir -r requirements.txt

# 預先下載 PaddleOCR 模型 (在建構時下載，避免首次啟動慢)
# 這會增加 Image 大小約 20MB，但大幅提升首次啟動速度
RUN python -c "from paddleocr import PaddleOCR; print('Downloading models...'); ocr = PaddleOCR(use_angle_cls=True, lang='ch', show_log=True); print('Models downloaded successfully')" || echo "Model download failed, will retry at runtime"

# 複製應用程式碼
COPY . .

# 暴露端口
EXPOSE 8000

# 健康檢查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')"

# 啟動服務
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
