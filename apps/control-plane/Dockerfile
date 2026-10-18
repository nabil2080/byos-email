FROM node:20-alpine

WORKDIR /app

COPY apps/control-plane/package*.json ./
RUN npm install

COPY apps/control-plane/ ./

EXPOSE 3000

ENV VITE_HOST=0.0.0.0
ENV VITE_API_URL=http://api:8080

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]
