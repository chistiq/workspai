using System.Text.Json;

class Health {
    public static string Status() => "ok";
}

app.MapGet("/health", () => JsonSerializer.Serialize(new { status = Health.Status() }));
