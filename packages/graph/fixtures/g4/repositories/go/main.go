package main

import (
	"fmt"
	"net/http"
)

func routes() {
	http.HandleFunc("/health", health)
}

func health(writer http.ResponseWriter, _ *http.Request) {
	writer.WriteHeader(http.StatusOK)
	fmt.Fprint(writer, "ok")
}
