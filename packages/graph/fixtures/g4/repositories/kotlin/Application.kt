import java.time.Instant
import kotlin.collections.List

@RestController
class Application {
  @GetMapping("/health")
  fun health() = Instant.now().toString()
}
