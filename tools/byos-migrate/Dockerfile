FROM golang:alpine AS builder

WORKDIR /app

COPY tools/byos-migrate/go.mod tools/byos-migrate/go.sum* ./
COPY tools/byos-migrate/*.go ./

RUN go mod tidy && go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -o byos-migrate .

FROM alpine:3.20

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /app/byos-migrate .

ENTRYPOINT ["./byos-migrate"]
CMD ["up"]
