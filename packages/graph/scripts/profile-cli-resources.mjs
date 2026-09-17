// Loaded only by the local profiler, never by the published CLI by default.
process.once('exit', () => {
  process.stderr.write(`GRAPH_PROFILE_RESOURCES=${JSON.stringify(process.resourceUsage())}\n`);
});
