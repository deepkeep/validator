FROM node:0.12.7

RUN mkdir validator
WORKDIR validator

COPY package.json package.json
RUN npm install

COPY . .

# the local.json file should be mounted to /validator/local.json
# the defined port in local.json should be linked to the container

CMD ["node", "index.js"]
