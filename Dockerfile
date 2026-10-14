FROM node:22-alpine

WORKDIR /app
COPY . .

RUN npm i
RUN npm run build:server -w app

EXPOSE 8080

CMD ["sh", "-c", "npm run build:client -w app; npm start"]
