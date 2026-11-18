# DKIM-01 offline key generation only, no SMTP and no DNS API permissions.
FROM python:3.12-alpine
RUN apk add --no-cache openssl \
    && addgroup -g 1001 readbox \
    && adduser -D -u 1001 -G readbox dkim \
    && mkdir -p /var/lib/readbox-dkim/private /etc/opendkim/keys /run/readbox-dkim \
    && chown -R 1001:1001 /var/lib/readbox-dkim /etc/opendkim/keys /run/readbox-dkim \
    && chmod 0700 /var/lib/readbox-dkim/private /run/readbox-dkim
COPY deployment/dkim/agent.py /usr/local/bin/dkim-agent.py
COPY deployment/dkim/test_agent.py /tmp/dkim-test.py
RUN python3 -B /tmp/dkim-test.py && rm /tmp/dkim-test.py
USER 1001:1001
ENTRYPOINT ["python3", "-B", "/usr/local/bin/dkim-agent.py"]
