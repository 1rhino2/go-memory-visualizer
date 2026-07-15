package main

import (
	"sync"
	"time"
)

// Demo structs for the visual memory map and known-stdlib sizing.
// Open this file, put the cursor in a struct, then run:
//   Go: Show Visual Memory Map

// Sparse has deliberate padding so the map lights up.
type Sparse struct {
	Active bool      // 1 + 7 pad
	ID     uint64    // 8
	Tag    uint8     // 1 + 7 pad
	Name   string    // 16
}

// Timed uses a known stdlib type (time.Time = 24B on amd64).
type Timed struct {
	Flag  bool
	When  time.Time
	Count int32
}

// Guarded mixes sync.Mutex (8B) with a small flag.
type Guarded struct {
	Mu    sync.Mutex
	Ready bool
}

// Packed is already dense - pack score should sit near 100%.
type Packed struct {
	A uint64
	B uint64
	C uint32
	D uint32
}
