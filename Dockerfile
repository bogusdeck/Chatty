FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY public ./public
COPY src ./src

ENV NODE_ENV=production
ENV TRUST_PROXY=true
ENV PORT=10000
EXPOSE 10000

CMD ["npm", "start"]
