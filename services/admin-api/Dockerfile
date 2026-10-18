FROM golang:alpine AS builder

WORKDIR /app

COPY services/admin-api/go.mod services/admin-api/go.sum ./
RUN go mod download

COPY services/admin-api/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /admin-api .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /admin-api .

EXPOSE 8087

ENV PORT=8087
ENV BYOS_DEV_MODE=1
ENV SUPPORT_DB_URL=postgres://role_support_agent:support_crm_password@postgres:5432/byos

CMD ["./admin-api"]
