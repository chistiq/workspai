import java.time.Instant;

class HealthController {
    @GetMapping("/health")
    String health() {
        return Instant.now().toString();
    }
}
