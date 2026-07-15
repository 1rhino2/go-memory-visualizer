# Go Memory Layout Visualizer - Live Demo

## What It Does

Visualizes Go struct memory layouts in real-time showing offsets, sizes, alignment, and padding waste.

## Features in Action

### 1. Real-Time Inline Annotations

```go
type User struct {
    // offset: 0 | size: 1 | align: 1 | padding: 7 
    Active  bool
    
    // offset: 8 | size: 8 | align: 8 | padding: 0
    ID      uint64
}
```

### 2. One-Click Optimization

CodeLens shows: `Optimize struct - save 14 bytes (29% reduction)`

Click it to automatically reorder fields optimally.

### 3. Hover Details

Hover any field to see:
- Complete memory layout
- Optimization suggestions  
- Performance impact

### 4. Padding Warnings

Fields with excessive padding highlighted in yellow/orange.

### 5. Multi-Architecture

Toggle between amd64, arm64, and 386 to see different layouts.

### 6. Visual Memory Map

Command: `Go: Show Visual Memory Map`

Opens a colored byte grid for the struct under the cursor, plus an ASCII
map you can paste into a PR. Pack score shows how dense the layout is.

See `examples/memory-map.go` for a ready-made demo.

## Real-World Examples

See `examples/demonstration.go` for 10 complete examples including:
- User profiles (29% to 15% waste)
- API responses (21% to 6% waste)
- Database models (22% to 11% waste)
- Network protocols (37% to 17% waste)

## Commands

- `Go: Show Memory Layout` - Full breakdown
- `Go: Show Visual Memory Map` - Byte grid + ASCII
- `Go: Optimize Struct` - Reorder fields (with preview)
- `Go: Toggle Architecture` - Switch platforms

Ready to save memory and improve cache efficiency!
