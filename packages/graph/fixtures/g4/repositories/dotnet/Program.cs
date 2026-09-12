using System.Text.Json;

app.MapGet("/health", () => JsonSerializer.Serialize(new { status = "ok" }));
