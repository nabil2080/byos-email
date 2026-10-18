FROM node:22-alpine

WORKDIR /app

COPY apps/public-site/package*.json ./
RUN npm install

COPY apps/public-site/ ./

EXPOSE 3002

ENV ASTRO_DEV_BACKGROUND=false
ENV ASTRO_HOST=0.0.0.0
ENV PUBLIC_CP_URL=http://localhost:3000
ENV PUBLIC_API_URL=http://localhost:8080

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3002"]
