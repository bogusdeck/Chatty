FROM node:20-alpine

WORKDIR /app

# Set env early so any change here busts the layer cache
ENV NODE_ENV=production
ENV TRUST_PROXY=true
ENV PORT=10000

COPY package.json ./
RUN npm install --omit=dev

COPY public ./public
COPY src ./src

EXPOSE 10000

CMD ["npm", "start"]
