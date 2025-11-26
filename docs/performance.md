# Performance Impact of Memory Layout

Understanding how memory layout affects performance in Go applications.

## Cache Lines and Performance

Modern CPUs fetch memory in 64-byte cache lines. When a struct spans multiple cache lines, accessing it requires multiple memory fetches, reducing performance.

### Example: Cache-Inefficient Struct

```go
type BadLayout struct {
    Field1 [60]byte  // Uses most of first cache line
    Flag   bool      // Forces second cache line
    Field2 int64     // Also in second cache line
}
```

### Optimized Layout

```go
type GoodLayout struct {
    Field1 [60]byte
    Field2 int64
    Flag   bool
}
```

## Memory Alignment Rules

Go follows specific alignment rules for different architectures:

### AMD64/ARM64 (64-bit)
- `bool`, `int8`, `uint8`: 1-byte alignment
- `int16`, `uint16`: 2-byte alignment
- `int32`, `uint32`, `float32`: 4-byte alignment
- `int64`, `uint64`, `float64`, `complex64`: 8-byte alignment
- Pointers, `string`, `slice`, `map`, `chan`, `interface`: 8-byte alignment

### 386 (32-bit)
- Same rules except pointers and reference types use 4-byte alignment

## Best Practices

1. **Order by alignment requirements** (descending)
2. **Group similar types together**
3. **Consider cache line boundaries** for hot paths
4. **Use the extension's optimization** for automatic reordering

## Real-World Performance Gains

- **API Servers**: 5-15% throughput improvement from better cache locality
- **Data Processing**: 10-20% faster iteration over large slices of structs
- **Memory Usage**: 10-30% reduction in heap allocations

## Benchmarking

Always benchmark your specific use case:

```go
func BenchmarkBadLayout(b *testing.B) {
    var s BadLayout
    for i := 0; i < b.N; i++ {
        _ = s.Flag
    }
}

func BenchmarkGoodLayout(b *testing.B) {
    var s GoodLayout
    for i := 0; i < b.N; i++ {
        _ = s.Flag
    }
}
```

## Tools

- **Go Memory Visualizer**: Real-time visualization and optimization
- **go tool compile -m**: Escape analysis
- **go build -gcflags=-m**: Additional compiler insights
- **pprof**: Memory profiling

## Further Reading

- [Go Memory Model](https://go.dev/ref/mem)
- [Mechanical Sympathy](https://mechanical-sympathy.blogspot.com/)
- [CPU Cache Effects](https://igoro.com/archive/gallery-of-processor-cache-effects/)
