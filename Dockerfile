FROM registry.heroiclabs.com/heroiclabs/nakama:3.21.1

COPY nakama/modules /nakama/data/modules

ENTRYPOINT ["/bin/sh", "-ec"]
CMD ["/nakama/nakama migrate up --database.address ${NAKAMA_POSTGRES_USERNAME}:${NAKAMA_POSTGRES_PASSWORD}@${NAKAMA_POSTGRES_HOST}:${NAKAMA_POSTGRES_PORT}/${NAKAMA_POSTGRES_DB} && exec /nakama/nakama --name ${NAKAMA_NAME:-nakama-render} --database.address ${NAKAMA_POSTGRES_USERNAME}:${NAKAMA_POSTGRES_PASSWORD}@${NAKAMA_POSTGRES_HOST}:${NAKAMA_POSTGRES_PORT}/${NAKAMA_POSTGRES_DB} --logger.level ${NAKAMA_LOG_LEVEL:-INFO} --session.token_expiry_sec ${NAKAMA_SESSION_TOKEN_EXPIRY_SEC:-7200} --socket.server_key ${NAKAMA_SOCKET_SERVER_KEY} --session.encryption_key ${NAKAMA_SESSION_ENCRYPTION_KEY} --session.refresh_encryption_key ${NAKAMA_REFRESH_ENCRYPTION_KEY} --runtime.http_key ${NAKAMA_RUNTIME_HTTP_KEY} --console.username ${NAKAMA_CONSOLE_USERNAME} --console.password ${NAKAMA_CONSOLE_PASSWORD} --console.signing_key ${NAKAMA_CONSOLE_SIGNING_KEY} --runtime.path /nakama/data/modules"]
