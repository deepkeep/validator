FROM node:0.12.7

RUN mkdir validator
WORKDIR validator

COPY package.json package.json
RUN npm install

COPY . .
COPY local-dist.json local.json

CMD ["node", "index.js"]
