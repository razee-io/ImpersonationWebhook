FROM node:16

WORKDIR /usr/src

COPY ./package*.json server.crt server.key ./

RUN npm install

COPY src/ .

EXPOSE 8443

USER 1000:1000

CMD [ "node", "index.js" ]
