package main

import "net/http"

func routes() {
    router.GET("/health", health)
}

func health(writer http.ResponseWriter, _ *http.Request) {
    writer.WriteHeader(http.StatusOK)
}
