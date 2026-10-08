FROM node:22-alpine
WORKDIR /srv/artymods
COPY server.js package.json ./
COPY public ./public
RUN mkdir -p data uploads public/downloads && chown -R node:node /srv/artymods
USER node
EXPOSE 3000
CMD ["node", "server.js"]
