FROM golang:1.26-alpine AS builder

WORKDIR /app

COPY go.mod ./
COPY crypto/ ./crypto/
COPY services/api/go.mod services/api/go.sum ./services/api/

WORKDIR /app/services/api
RUN go mod download

WORKDIR /app
COPY services/api/ ./services/api/

WORKDIR /app/services/api
RUN CGO_ENABLED=0 GOOS=linux go build -o /api .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /api .

EXPOSE 8080

CMD ["./api"]
