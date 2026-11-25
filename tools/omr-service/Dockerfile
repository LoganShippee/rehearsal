FROM eclipse-temurin:17-jre-jammy

ARG AUDIVERIS_VERSION=5.3.1
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive \
    OMR_HOST=0.0.0.0 \
    OMR_PORT=8788 \
    OMR_AUTH_MODE=optional \
    OMR_RETENTION_HOURS=24 \
    OMR_DATA_DIR=/data \
    TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ca-certificates \
    curl \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-lat \
    fontconfig \
    libxrender1 \
    libxtst6 \
    libxi6 \
    && rm -rf /var/lib/apt/lists/*

# Install unmodified Audiveris 5.x (AGPL v3) strictly as an external CLI binary.
# Rehearsal invokes Audiveris only as an isolated subprocess (never linked/imported).
RUN set -eux; \
    arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    if [ "$arch" = "amd64" ]; then \
      deb_url="https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu22.04-x86_64.deb"; \
      curl -fsSL "$deb_url" -o /tmp/audiveris.deb; \
      apt-get update && apt-get install -y --no-install-recommends /tmp/audiveris.deb; \
      rm -f /tmp/audiveris.deb && rm -rf /var/lib/apt/lists/*; \
    else \
      echo "Note: Official Audiveris ${AUDIVERIS_VERSION} .deb is x86_64 only; on ${arch} use --platform=linux/amd64 or mount AUDIVERIS_BIN." >&2; \
    fi; \
    if [ ! -e /usr/bin/audiveris ] && [ -x /opt/audiveris/bin/Audiveris ]; then \
      ln -sf /opt/audiveris/bin/Audiveris /usr/bin/audiveris; \
    fi

WORKDIR /app
COPY server.py run.sh /app/
RUN chmod +x /app/server.py /app/run.sh && mkdir -p /data

VOLUME ["/data"]
EXPOSE 8788

CMD ["python3", "/app/server.py"]
