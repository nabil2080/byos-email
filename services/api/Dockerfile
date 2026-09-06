FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod ./
COPY *.go ./
RUN go mod tidy
RUN go mod download

RUN CGO_ENABLED=0 GOOS=linux go build -o api .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /app/api .

EXPOSE 8080

CMD ["./api"]
