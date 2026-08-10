# Multi-stage: build estático → imagem distroless mínima. Railway builda a partir deste Dockerfile.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Binário estático (sem libc) pro distroless/static. -s -w tira símbolos/debug.
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w -X github.com/Gsfrota/efinance-bot-go/internal/httpapi.Version=${VERSION}" \
    -o /bot ./cmd/bot

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /bot /bot
# Railway injeta PORT; o app faz bind em :$PORT (default 8080).
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/bot"]
