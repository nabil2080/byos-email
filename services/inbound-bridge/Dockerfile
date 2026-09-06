FROM golang:1.23-alpine AS builder

WORKDIR /app

COPY go.mod ./
COPY main.go ./
RUN go mod tidy
RUN go mod download

RUN CGO_ENABLED=0 GOOS=linux go build -o inbound-bridge .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /app/inbound-bridge .

EXPOSE 25 8085

CMD ["./inbound-bridge"]
