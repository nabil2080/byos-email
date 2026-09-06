FROM golang:1.23-alpine AS builder

WORKDIR /app

COPY go.mod ./
COPY main.go ./
RUN go mod tidy
RUN go mod download

RUN CGO_ENABLED=0 GOOS=linux go build -o outbound-worker .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /app/outbound-worker .

EXPOSE 8086

CMD ["./outbound-worker"]
