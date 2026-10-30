FROM node:22-alpine
WORKDIR /app
COPY relay/package*.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts && npm cache clean --force
COPY desktop/src/listen/relay.js ./relay.js
USER node
ENV PORT=8448
EXPOSE 8448/tcp
CMD ["node", "--max-old-space-size=48", "relay.js"]
