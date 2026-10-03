FROM python:3.12-slim AS qcl-source

ARG QCL_SOURCE_REF=f480c3e04805655f0c346a362acb3bf852d80559

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && git clone --depth 1 https://github.com/jburnett1291-dot/QCL.git /opt/qcl-source \
    && git -C /opt/qcl-source fetch --depth 1 origin "${QCL_SOURCE_REF}" \
    && git -C /opt/qcl-source checkout --detach "${QCL_SOURCE_REF}" \
    && rm -rf /opt/qcl-source/.git \
    && apt-get purge -y --auto-remove git \
    && rm -rf /var/lib/apt/lists/*

FROM python:3.12-slim

WORKDIR /app

COPY --from=qcl-source /opt/qcl-source /opt/qcl-source
COPY requirements.txt .
RUN pip install --no-cache-dir --disable-pip-version-check \
    -r requirements.txt \
    -r /opt/qcl-source/requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1
ENV QCL_STREAMLIT_SOURCE_DIR=/opt/qcl-source
ENV QCL_STREAMLIT_PORT=8501

CMD ["python", "server.py"]
