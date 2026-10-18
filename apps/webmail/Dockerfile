FROM node:20-alpine

WORKDIR /app

COPY apps/webmail/package*.json ./
RUN npm install

COPY apps/webmail/ ./

EXPOSE 3001

ENV VITE_HOST=0.0.0.0
ENV VITE_API_URL=http://api:8080

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3001"]
