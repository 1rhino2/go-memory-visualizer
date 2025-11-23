package main

import (
	"fmt"
	"unsafe"
)

// Base types used in nested structs
type Point struct {
	X float64 // 8 bytes
	Y float64 // 8 bytes
}

type Dimensions struct {
	Width  uint32 // 4 bytes
	Height uint32 // 4 bytes
}

// Nested struct example
type Rectangle struct {
	TopLeft Point      // 16 bytes (nested struct)
	Size    Dimensions // 8 bytes (nested struct)
	Color   uint32     // 4 bytes
	Visible bool       // 1 byte + 3 padding
}

// Deeply nested example
type Canvas struct {
	Name       string    // 16 bytes
	Background uint32    // 4 bytes
	Active     bool      // 1 byte + 3 padding
	Rect       Rectangle // varies (nested Rectangle which contains nested structs)
	ZIndex     int32     // 4 bytes
}

// Nested with pointers
type Node struct {
	Value int64  // 8 bytes
	Left  *Node  // 8 bytes (pointer)
	Right *Node  // 8 bytes (pointer)
	Data  string // 16 bytes
}

// Multiple nested structs
type Scene struct {
	ID         uint64    // 8 bytes
	MainRect   Rectangle // nested
	SecondRect Rectangle // nested
	Active     bool      // 1 byte
}

// Nested arrays of structs
type Grid struct {
	Cells  [4]Point // 64 bytes (4 * 16)
	Name   string   // 16 bytes
	Active bool     // 1 byte + 7 padding
}

func main() {
	rect := Rectangle{}
	canvas := Canvas{}
	node := Node{}
	scene := Scene{}
	grid := Grid{}

	fmt.Printf("Point size: %d bytes\n", unsafe.Sizeof(Point{}))
	fmt.Printf("Dimensions size: %d bytes\n", unsafe.Sizeof(Dimensions{}))
	fmt.Printf("Rectangle size: %d bytes\n", unsafe.Sizeof(rect))
	fmt.Printf("Canvas size: %d bytes\n", unsafe.Sizeof(canvas))
	fmt.Printf("Node size: %d bytes\n", unsafe.Sizeof(node))
	fmt.Printf("Scene size: %d bytes\n", unsafe.Sizeof(scene))
	fmt.Printf("Grid size: %d bytes\n", unsafe.Sizeof(grid))
}
