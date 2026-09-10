FROM node:18-alpine
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install
RUN npx prisma generate
COPY . .
EXPOSE 4000
CMD ["npm", "run", "dev"]
