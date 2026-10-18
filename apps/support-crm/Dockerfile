FROM node:20-alpine

WORKDIR /app

COPY apps/support-crm/package*.json ./
RUN npm install

COPY apps/support-crm/ ./

EXPOSE 3003

ENV VITE_HOST=0.0.0.0
ENV VITE_ADMIN_API_URL=http://admin-api:8087

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3003"]
