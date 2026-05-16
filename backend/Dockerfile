FROM python:3.12-slim

# pymupdf + libreoffice (headless, for Office → PDF conversion)
# fonts-noto-cjk: 繁中字型，避免轉檔變方塊
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev mupdf-tools git openssh-client \
    libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress \
    fonts-noto-cjk fonts-noto-cjk-extra \
    && rm -rf /var/lib/apt/lists/*

# Pre-create LibreOffice user profile dir to avoid first-run delay
ENV HOME=/tmp
RUN mkdir -p /tmp/.config/libreoffice

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
